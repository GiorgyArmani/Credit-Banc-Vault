// The "What you need" section's centrepiece.
//
// WHY THIS REPLACED THE CHECKLIST. The first version of this section was an
// interactive per-product checklist: pick a funding product, watch twenty-one
// document rows render. It was accurate and it was the wrong promise. A
// prospect who has not spoken to an advisor reads a twenty-one-row grid as
// "this is what they will make me do", and the honest answer is that nobody
// gets the whole package — the ask is assembled per file, and most files land
// far under the maximum.
//
// It was also a transcription. The counts were hand-copied from
// @/data/program-document-packages, which is advisor-facing config that changes
// without a marketing review, so the page carried a standing drift risk in
// exchange for a claim we would rather not make.
//
// So the section now states the rule instead of enumerating an instance. No
// document names, no counts, nothing to keep in sync.

import { FileStack, ListChecks, MessageSquareText } from "lucide-react";

interface Point {
  icon: typeof FileStack;
  title: string;
  body: string;
}

const POINTS: Point[] = [
  {
    icon: FileStack,
    title: "Built from your file",
    body:
      "Your industry, your time in business, the product you're after and how you're being underwritten all change the ask. We assemble the list once we know those, not before.",
  },
  {
    icon: ListChecks,
    title: "Only what yours needs",
    body:
      "You are never handed a generic packet to work through. If a document isn't on your checklist, we aren't asking for it — and you're not chasing paperwork that was never going to matter.",
  },
  {
    icon: MessageSquareText,
    title: "New asks come with a reason",
    body:
      "If underwriting needs something else once your file is moving, it appears in your checklist with a note explaining why — never as a surprise phone call.",
  },
];

export function ProgramDocuments() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {POINTS.map(({ icon: Icon, title, body }) => (
        <div
          key={title}
          className="rounded-2xl border border-white/10 bg-white/[0.06] p-7 sm:p-8"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cb-mint/15 text-cb-mint">
            <Icon className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <h3 className="mt-5 font-headline text-xl font-extrabold tracking-tight text-white">
            {title}
          </h3>
          <p className="mt-3 text-[15px] leading-relaxed text-white/60">{body}</p>
        </div>
      ))}
    </div>
  );
}
