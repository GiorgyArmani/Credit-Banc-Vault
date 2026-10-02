// src/lib/post-funding/steps.ts
//
// The post-funding client email sequence: what each of the 9 emails says, when
// it goes out, and the one rule that decides which step a funded round is on.
// Pure — no DB, no mail — so the schedule is unit-testable. The runner is
// sequence.ts; the HTML/text rendering is generate_post_funding_email_* in
// lib/email.ts.
//
// Schedule (days after funded_at): 0, 7, 30, then every 30 days to 210 — Email 9
// says "about seven months", which is day 210.
//
// WINDOWS, not just due dates. Each step may only go out between its own day
// and the next step's day (the last one gets 30 days). A step whose window has
// already closed is SKIPPED, never sent late. That is what lets rounds funded
// before this shipped join mid-sequence without getting "You're funded" two
// months after the fact, and what keeps a cron outage from turning into a burst
// of catch-up mail. At most one step goes out per round per run.

export type PostFundingLink =
  | "review"
  | "booking"
  | "weekly"
  | "affiliate"
  | "podcastListen"
  | "podcastWatch"
  | "youtube";

/**
 * A piece of the email body. Text is plain and HTML-safe as written — the copy
 * contains no markup characters, and the only dynamic value (the first name) is
 * escaped by the HTML template before it gets here. A test pins that.
 */
export type PostFundingBlock =
  | { kind: "p"; text: string; inline?: { label: string; link: PostFundingLink } }
  | { kind: "button"; label: string; link: PostFundingLink };

export interface PostFundingStep {
  step: number;
  /** Days after funded_at that the step becomes due. */
  day: number;
  subject: string;
  /** Inbox preview text. */
  preheader: string;
  /** Everything above the signature. */
  body: (firstName: string) => PostFundingBlock[];
  /** Anything below the signature (Email 4's P.S.). */
  postscript?: (firstName: string) => PostFundingBlock[];
}

const p = (text: string): PostFundingBlock => ({ kind: "p", text });
const button = (label: string, link: PostFundingLink): PostFundingBlock => ({ kind: "button", label, link });

export const POST_FUNDING_STEPS: PostFundingStep[] = [
  {
    step: 1,
    day: 0,
    subject: "Well, look at you. You’re funded.",
    preheader: "Thanks for trusting us with this one.",
    body: (name) => [
      p(`Hi ${name},`),
      p("You’re funded. Which is a pretty good reason to open an email from us."),
      p("Just wanted to personally say thanks for trusting me and the Credit Banc team to help get this one across the finish line."),
      p("We know business financing isn’t exactly how most people choose to spend their free time, so we appreciate you letting us be the ones to help you through it."),
      p("From here, go put that capital to work."),
      p("I’ll check in from time to time, but if something comes up before then- a question, another opportunity, a new plan, whatever- just reach out. You’ve got my number."),
      p(`Thanks again, ${name}.`),
      p("Now go enjoy the fun part."),
    ],
  },
  {
    step: 2,
    day: 7,
    subject: "It’s been a week. Still like us?",
    preheader: "Checking in, plus one small favor.",
    body: (name) => [
      p(`Hi ${name},`),
      p("It’s been about a week since you funded, so I wanted to check in."),
      p("Everything going smoothly?"),
      p("If you have any questions or need something from me, I’m still here. We don’t disappear into the bushes once the money hits your account."),
      p("And while everything is still fresh, I do have one small favor to ask."),
      p("If you had a good experience working with us, would you mind leaving Credit Banc a quick Google review?"),
      p("It doesn’t need to be a novel. A sentence or two about your experience helps other business owners figure out who they’re dealing with before they trust a bunch of strangers on the internet with their financing."),
      button("LEAVE A GOOGLE REVIEW", "review"),
      p(`Thanks again, ${name}. I appreciate you trusting us with this one.`),
    ],
  },
  {
    step: 3,
    day: 30,
    subject: "We read the boring stuff so you don’t have to.",
    preheader: "Something I think you’ll enjoy every Friday.",
    body: (name) => [
      p(`Hi ${name},`),
      p("Wanted to pass along something I think you might enjoy."),
      p("It’s called The Weekly."),
      p("Every Friday, the team digs through what’s happening in business, money, tech, the economy, and the occasional completely ridiculous story, and pulls together the stuff worth knowing about."),
      p("Basically, we read the boring stuff so you don’t have to."),
      p("It’s quick, free, and written for business owners who want to know what’s going on without making a second career out of keeping up with the news."),
      button("CHECK OUT THE WEEKLY ON SUBSTACK", "weekly"),
      p("Give it a read. I think you’ll like it."),
      p("And as always, if something comes up with the business and you want to kick it around, just reach out. Happy to help."),
      button("SCHEDULE A QUICK CALL", "booking"),
      p("Talk soon,"),
    ],
  },
  {
    step: 4,
    day: 60,
    subject: "So, what’s new?",
    preheader: "Anything you want to bounce off someone?",
    body: (name) => [
      p(`Hi ${name},`),
      p("Just wanted to check in. How are things going?"),
      p("Anything new happening with the business? Anything you’re working through, thinking about, or just want to bounce off someone?"),
      p("If so, give me a shout. Happy to kick it around with you and see if I can help."),
      button("GRAB A FEW MINUTES WITH ME", "booking"),
      p("Talk soon,"),
    ],
    postscript: () => [
      {
        kind: "p",
        text: "P.S. Still haven’t left us a Google review? I’m going to assume you’ve been very busy. If you’ve got a minute, we’d appreciate a few words about your experience.",
        inline: { label: "LEAVE A QUICK REVIEW", link: "review" },
      },
    ],
  },
  {
    step: 5,
    day: 90,
    subject: "Thought you might like this…",
    preheader: "Know a business owner who could use a hand?",
    body: (name) => [
      p(`Hi ${name},`),
      p("You’ve worked with us, so you’ve got a pretty good idea of what we do and how we roll."),
      p("So I wanted to make sure you knew about Credit Banc’s Affiliate Program."),
      p("If you know another business owner who could use our help, you can send them our way. We’ll take it from there, and if they fund with us, you get a $500 gift card."),
      p("Pretty simple."),
      p("There’s no limit on referrals either, so if you happen to know a lot of business owners, even better."),
      button("CHECK OUT THE AFFILIATE PROGRAM", "affiliate"),
      p("Thought it might be something you’d want to take advantage of."),
      p("Talk soon,"),
    ],
  },
  {
    step: 6,
    day: 120,
    subject: "Got 30 minutes?",
    preheader: "A business podcast that skips the 4 a.m. lectures.",
    body: (name) => [
      p(`Hi ${name},`),
      p("Wanted to send you something I think you might like."),
      p("If you haven’t checked out The Liquid Lunch Project, it’s a business podcast, but thankfully not the kind where someone spends 45 minutes telling you to wake up at 4 a.m."),
      p("The conversations are with business owners, entrepreneurs, and experts about what it’s actually like to run and grow a company."),
      p("Money. Growth. Leadership. Hiring. Mistakes. Wins. And plenty of things that don’t usually make it into the business books."),
      button("LISTEN TO THE LIQUID LUNCH PROJECT", "podcastListen"),
      button("WATCH THE LIQUID LUNCH PROJECT", "podcastWatch"),
      p("There are a bunch of episodes up, so poke around and see what catches your attention."),
      p("And if you need anything from me, just reach out. Always happy to catch up."),
      p("Talk soon,"),
    ],
  },
  {
    step: 7,
    day: 150,
    subject: "Keep us in your back pocket",
    preheader: "What we helped with before isn’t the only thing we can help with.",
    body: (name) => [
      p(`Hi ${name},`),
      p("When we worked together last time, you came to us for one specific need. But a lot can change after that. New plans come up, priorities shift, a surprise expense. You get where I’m going."),
      p("So one thing I want you to keep in mind: whatever we helped you with before isn’t the only thing I can help you with."),
      p("Working capital, lines of credit, equipment, real estate, acquisitions, refinancing... there are a lot of different ways we can structure financing depending on what you’re trying to do."),
      p("You don’t need to remember the list."),
      p("Just remember if something comes up and money is part of the equation, give me a call before you assume you know what your options are."),
      p("There may be a better way to handle it than you think."),
      p("I’m always happy to take a look."),
    ],
  },
  {
    step: 8,
    day: 180,
    subject: "We made the boring stuff watchable",
    preheader: "Financing, credit and cash flow, in a few minutes at a time.",
    body: (name) => [
      p(`Hi ${name},`),
      p("Not sure if I’ve ever mentioned this to you, but we have a YouTube channel with a bunch of good stuff on it."),
      p("We cover financing, credit, cash flow, different funding options, and other things that come up when you’re running a business. Nothing too long or complicated. Just useful information when you’ve got a few minutes."),
      button("CHECK OUT THE CHANNEL", "youtube"),
      p("Also, since I’ve got you, a reminder about our Affiliate Program. If you know another business owner who could use our help, send them our way. If they fund with us, you get a $500 gift card."),
      button("LEARN MORE", "affiliate"),
      p("And on your end, if there’s anything you’ve been thinking about or want me to take a look at, just reach out. Happy to help."),
      p("Talk soon,"),
    ],
  },
  {
    step: 9,
    day: 210,
    subject: "A lot can change in 7 months",
    preheader: "Your options could look different now.",
    body: (name) => [
      p(`Hi ${name},`),
      p("Hard to believe, but it’s been about seven months since we got you funded."),
      p("That’s enough time for quite a bit to change."),
      p("Maybe revenue is up. Balances have come down. Credit has improved. Maybe the business looks completely different than it did seven months ago."),
      p("Which means your options could look different, too."),
      p("I think it’s worth taking another look at where things stand now, even if you don’t have an immediate need."),
      p("We can spend a few minutes going through what’s changed and see what might be available to you today."),
      p("Worst case, you know where you stand."),
      p("Best case, we find something worth talking about."),
      button("LET’S TAKE ANOTHER LOOK", "booking"),
      p("Grab a time that works for you, and we’ll catch up."),
      p("Talk soon,"),
    ],
  },
];

/** The last step's window: it may go out up to this many days after its due day. */
const LAST_STEP_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export function getStep(step: number): PostFundingStep {
  const found = POST_FUNDING_STEPS.find((s) => s.step === step);
  if (!found) throw new Error(`Unknown post-funding step ${step}`);
  return found;
}

export type NextAction =
  /** Send `step` now. `skip` lists earlier steps whose windows closed unsent. */
  | { kind: "send"; step: number; skip: number[] }
  /** Nothing due yet; `step` becomes due at `dueAt`. */
  | { kind: "wait"; step: number; dueAt: Date; skip: number[] }
  /** Every step is recorded (or skippable) — the sequence is over. */
  | { kind: "done"; skip: number[] };

/**
 * Decide what a funded round needs right now, given the steps already recorded
 * for it (sent OR skipped). See the WINDOWS note at the top of this file.
 */
export function nextAction(fundedAt: Date, recorded: ReadonlySet<number>, now: Date): NextAction {
  const skip: number[] = [];
  const funded = fundedAt.getTime();

  for (let i = 0; i < POST_FUNDING_STEPS.length; i++) {
    const s = POST_FUNDING_STEPS[i];
    if (recorded.has(s.step)) continue;

    const opens = funded + s.day * DAY_MS;
    const nextDay = POST_FUNDING_STEPS[i + 1]?.day ?? s.day + LAST_STEP_WINDOW_DAYS;
    const closes = funded + nextDay * DAY_MS;

    if (now.getTime() < opens) return { kind: "wait", step: s.step, dueAt: new Date(opens), skip };
    if (now.getTime() >= closes) {
      skip.push(s.step);
      continue;
    }
    return { kind: "send", step: s.step, skip };
  }

  return { kind: "done", skip };
}
