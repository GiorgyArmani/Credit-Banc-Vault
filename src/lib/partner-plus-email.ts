// src/lib/partner-plus-email.ts
//
// Partner+ emails. Kept out of src/lib/email.ts on purpose: that module is a
// 5,000-line shared file under active edit, and these three templates have no
// reason to share a diff with it. Same transport settings, same escaping rule
// ([[email_html_escaping]]): every HTML template escapes its data first.
//
// No inlined hero images — a missing committed PNG throws at send time
// ([[email_hero_images_must_be_committed]]), and the welcome email is the only
// way a freshly paid rep can get in.

import nodemailer from "nodemailer";
import { escape_html } from "@/lib/email";

function transporter() {
  return nodemailer.createTransport(
    {
      host: process.env.SMTP_HOST || "smtp.mailgun.org",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    },
    // Same reason as email.ts: Mailgun's tracking subdomain is dead, so a
    // rewritten link would break the magic link.
    { headers: { "X-Mailgun-Track-Clicks": "no", "X-Mailgun-Track-Opens": "no" } }
  );
}

function from(): string {
  const email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const name = process.env.SMTP_FROM_NAME || "Credit Banc";
  return `${name} <${email}>`;
}

function esc<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const [k, v] of Object.entries(out)) if (typeof v === "string") out[k] = escape_html(v);
  return out as T;
}

function shell(opts: { eyebrow: string; title: string; preheader: string; body: string }): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#faf9f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${opts.preheader}</div>
  <table role="presentation" style="width:100%;border-collapse:collapse;background-color:#faf9f6;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(32,37,54,0.08);">
        <tr><td style="padding:40px 40px 8px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#10b981;">${opts.eyebrow}</p>
          <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:800;color:#202536;">${opts.title}</h1>
        </td></tr>
        ${opts.body}
        <tr><td style="padding:24px 40px 32px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6;border-top:1px solid #f1f5f9;">
          <p style="margin:0;">&copy; ${new Date().getFullYear()} Credit Banc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `
        <tr><td style="padding:24px 40px 8px;" align="center">
          <a href="${href}" style="display:inline-block;background-color:#10b981;color:#ffffff;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:700;">${label}</a>
        </td></tr>`;
}

function paragraphs(...lines: string[]): string {
  return `
        <tr><td style="padding:16px 40px 0;font-size:15px;line-height:1.7;color:#475569;">
          ${lines.map((l) => `<p style="margin:0 0 16px;">${l}</p>`).join("")}
        </td></tr>`;
}

function fallbackLink(url: string): string {
  return `
        <tr><td style="padding:16px 40px 24px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all;">Button not working? Paste this into your browser:<br>${url}</p>
        </td></tr>`;
}

// ── Welcome: the paid rep's way in ──────────────────────────────────────────

export interface PartnerPlusWelcomeData {
  first_name: string;
  email: string;
  /** /auth/magic?…&next=/desk/welcome — a one-click sign-in. */
  magic_link: string;
}

export function generate_partner_plus_welcome_html(raw: PartnerPlusWelcomeData): string {
  const d = esc({ ...raw });
  return shell({
    eyebrow: "Partner+",
    title: "Your desk is ready",
    preheader: "Your Partner+ subscription is active. Sign in to set up your desk.",
    body:
      paragraphs(
        `Hi ${d.first_name},`,
        `Thanks for subscribing to <strong style="color:#202536;">Partner+</strong>. Your account is live.`,
        `Click below to sign in. You'll choose a password, add the number your clients will reach you on, sign a W-9, and upload a voided check. It takes about five minutes, and then you can start submitting deals.`
      ) +
      button(d.magic_link, "Set up my desk") +
      paragraphs(
        `This link signs you in as <strong style="color:#202536;">${d.email}</strong>, so please don't forward it.`
      ) +
      fallbackLink(d.magic_link),
  });
}

export async function send_partner_plus_welcome_email(data: PartnerPlusWelcomeData) {
  return transporter().sendMail({
    from: from(),
    to: data.email,
    subject: "Your Partner+ desk is ready",
    html: generate_partner_plus_welcome_html(data),
  });
}

// ── Payment failed: past_due, desk still open ───────────────────────────────

export interface PartnerPlusPaymentFailedData {
  first_name: string;
  email: string;
  /** /desk/billing — opens the Stripe Billing Portal from there. */
  billing_url: string;
}

export function generate_partner_plus_payment_failed_html(raw: PartnerPlusPaymentFailedData): string {
  const d = esc({ ...raw });
  return shell({
    eyebrow: "Partner+ billing",
    title: "We couldn't process your payment",
    preheader: "Update your card to keep your Partner+ desk open.",
    body:
      paragraphs(
        `Hi ${d.first_name},`,
        `Your latest Partner+ payment didn't go through. Your desk is <strong style="color:#202536;">still open</strong>, and we'll retry the charge automatically over the next few days.`,
        `If the retries fail, your desk will be paused until the card is updated. Your clients and your deals in underwriting aren't affected either way.`
      ) +
      button(d.billing_url, "Update payment method") +
      fallbackLink(d.billing_url),
  });
}

export async function send_partner_plus_payment_failed_email(data: PartnerPlusPaymentFailedData) {
  return transporter().sendMail({
    from: from(),
    to: data.email,
    subject: "Action needed: your Partner+ payment failed",
    html: generate_partner_plus_payment_failed_html(data),
  });
}

// ── Provisioning error: a card cleared but no account was made ──────────────

export interface PartnerPlusProvisioningErrorData {
  admin_emails: string[];
  customer_name: string;
  customer_email: string;
  company_name: string;
  reason: string;
  admin_url: string;
  stripe_url: string;
}

export function generate_partner_plus_provisioning_error_html(
  raw: PartnerPlusProvisioningErrorData
): string {
  const rest: Omit<PartnerPlusProvisioningErrorData, "admin_emails"> = {
    customer_name: raw.customer_name,
    customer_email: raw.customer_email,
    company_name: raw.company_name,
    reason: raw.reason,
    admin_url: raw.admin_url,
    stripe_url: raw.stripe_url,
  };
  const d = esc(rest);
  return shell({
    eyebrow: "Partner+ — needs attention",
    title: "A paid signup couldn't be provisioned",
    preheader: `${rest.customer_email} paid for Partner+ but has no account yet.`,
    body:
      paragraphs(
        `<strong style="color:#202536;">${d.customer_name}</strong> (${d.customer_email}${
          d.company_name ? `, ${d.company_name}` : ""
        }) completed Partner+ checkout, but we did not create their account.`,
        `<strong style="color:#202536;">Reason:</strong> ${d.reason}`,
        `Their subscription is active in Stripe and they are being charged. Resolve it on the admin page — usually by refunding and cancelling in Stripe, or by contacting them about the email they used.`
      ) +
      button(d.admin_url, "Open Partner+ admin") +
      paragraphs(`<a href="${d.stripe_url}" style="color:#10b981;">View the customer in Stripe</a>`),
  });
}

export async function send_partner_plus_provisioning_error_notification(
  data: PartnerPlusProvisioningErrorData
) {
  if (!data.admin_emails.length) return null;
  return transporter().sendMail({
    from: from(),
    to: data.admin_emails,
    subject: `Partner+ signup needs attention: ${data.customer_email}`,
    html: generate_partner_plus_provisioning_error_html(data),
  });
}
