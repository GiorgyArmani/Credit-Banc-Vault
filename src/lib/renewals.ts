// src/lib/renewals.ts
//
// When is a funded client due a check-in?
//
// This owns the three renewal_* columns on funding_deals (hence the file name),
// but the intent is narrower than the column names suggest: it is NOT a claim
// that the client is ready to borrow again. Nothing in the vault knows that.
// Some clients come back within months, others after more than a year. The date
// this computes is a prompt for the advisor to pick up the phone, ask how the
// business is doing, and find out whether they need anything. More capital is
// one possible outcome of that call, not its premise.
//
// One constant, one function — deliberately. The original plan said the date
// should come from "the product's rules", but those rules don't exist anywhere
// in the codebase: `funded_term` is a required FREE-TEXT input on the Loan
// Funded dialog ("e.g. 12 Months"). Scheduling client contact off a string a
// human typed is a silent-wrong-answer machine. A flat interval is honest about
// what it is.
//
// Both dates are written at funding time by fundLoanAction, and derived on the
// fly by /api/cron/client-check-ins for rounds that funded before this shipped —
// every existing funded deal has NULL in these columns, and backfilling them
// would need a migration for something the cron can compute itself.

/** Months after funded_at before the advisor is prompted to check in. */
export const CHECK_IN_AFTER_MONTHS = 3;

/**
 * Days BEFORE the check-in date to nudge. Zero = alert on the date itself
 * (the current choice). Raising this is the only change needed to introduce a
 * lead time — the cron already reads renewal_reminder_at.
 */
export const CHECK_IN_REMINDER_LEAD_DAYS = 0;

/**
 * How often to re-nudge if nobody acts. `null` = alert once and never again,
 * which is the current choice and what renewal_alert_sent_at was designed for.
 *
 * Set this to a number of days to turn the one-shot into a standing cadence
 * (the cron re-alerts when renewal_alert_sent_at is older than this, until a
 * new round opens on the business). No schema change either way — it is only a
 * different reading of the same column. Worth revisiting: a single nudge at
 * month 3 does little for a relationship that may run past a year.
 */
export const CHECK_IN_REPEAT_EVERY_DAYS: number | null = null;

/**
 * Adds whole months without the day-overflow surprise: JS `setMonth` turns
 * Nov 30 + 3 into Mar 2 (February has no 30th). Clamping to the last valid day
 * keeps "3 months later" landing in the month a human would name.
 */
function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const out = new Date(date.getTime());
  // Park on the 1st first so the month arithmetic can't roll over.
  out.setUTCMonth(out.getUTCMonth() + months, 1);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)
  ).getUTCDate();
  out.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return out;
}

export interface CheckInDates {
  /** Stored on renewal_eligibility_date — when the client is due contact. */
  eligibilityDate: string;
  /** Stored on renewal_reminder_at — when to tell the advisor. */
  reminderAt: string;
}

/**
 * The check-in schedule for a round, from the moment it funded. Returns null
 * for a round that isn't funded or whose funded_at is unparseable — callers
 * treat that as "no schedule", never as "due now".
 */
export function computeRenewalDates(
  fundedAt: string | Date | null | undefined
): CheckInDates | null {
  if (!fundedAt) return null;

  const funded = fundedAt instanceof Date ? fundedAt : new Date(fundedAt);
  if (Number.isNaN(funded.getTime())) return null;

  const eligibility = addMonths(funded, CHECK_IN_AFTER_MONTHS);
  const reminder = new Date(eligibility.getTime() - CHECK_IN_REMINDER_LEAD_DAYS * 86_400_000);

  return {
    eligibilityDate: eligibility.toISOString(),
    reminderAt: reminder.toISOString(),
  };
}

/**
 * When the advisor should be nudged about this round: the stored reminder if
 * fundLoanAction wrote one, otherwise derived from funded_at. This is what lets
 * the cron cover rounds funded before the renewal columns were ever populated.
 */
export function resolveReminderAt(deal: {
  funded_at: string | null;
  renewal_reminder_at?: string | null;
}): string | null {
  if (deal.renewal_reminder_at) return deal.renewal_reminder_at;
  return computeRenewalDates(deal.funded_at)?.reminderAt ?? null;
}

/**
 * Has this round already been alerted on? Under the one-shot default any stamp
 * at all means done; with a repeat cadence configured, a stamp older than the
 * interval comes due again.
 */
export function alreadyAlerted(
  alertSentAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!alertSentAt) return false;
  if (CHECK_IN_REPEAT_EVERY_DAYS === null) return true;

  const sent = new Date(alertSentAt);
  if (Number.isNaN(sent.getTime())) return true; // unreadable stamp — don't re-spam
  return now.getTime() - sent.getTime() < CHECK_IN_REPEAT_EVERY_DAYS * 86_400_000;
}
