// src/lib/watermark.ts
//
// Server-only. Stamps a document with the Credit Banc mark and caches the
// result, so a lender never receives a file that doesn't say where it came from.
//
// WHAT THIS IS FOR. A lender holding a full packet can fund the deal directly
// or shop it on, cutting us out. A stamp does not prevent them PROCESSING the
// file — OCR reads a marked PDF fine — but it makes the document unusable for
// RE-SUBMISSION, because the next funder can see it is someone else's brokered
// deal. That is the deterrent that operates here.
//
// WHY SERVER-SIDE. The recipient is the adversary. Stamping in the browser
// would mean shipping the signed URL of the clean original to the person we are
// stamping against — one devtools tab and the control is gone. The lender page
// therefore never receives a URL to the original at all.
//
// WHY CACHED DERIVATIVES. Stamping 155 files inside one request would blow the
// function's time limit, and streaming every byte through the API route would
// cost us the bandwidth twice and cap how large a packet can be. Instead each
// file is stamped ONCE, on first access, into `watermarked/<original path>`;
// after that the route just 302s to a signed URL for the cached copy and the
// bytes travel Supabase → browser directly. The stamp is generic (no lender
// name), so one derivative serves every link that ever exposes that document.

import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DOCUMENTS_BUCKET = "user-documents";
export const WATERMARK_PREFIX = "watermarked";

/** Cache location for a stamped copy. Deterministic — no bookkeeping column. */
export function watermarkedPathFor(storage_path: string): string {
  // Always .pdf: images are converted to a single-page PDF so they can carry a
  // stamp without pulling in an image-processing dependency.
  const without_ext = storage_path.replace(/\.[A-Za-z0-9]+$/, "");
  return `${WATERMARK_PREFIX}/${without_ext}.pdf`;
}

/** True when we can stamp this type at all. */
export function isStampable(mime: string | null | undefined, name: string): boolean {
  const lower = (mime || "").toLowerCase();
  if (lower.includes("pdf")) return true;
  if (lower.startsWith("image/")) {
    // pdf-lib embeds JPEG and PNG only. A HEIC or TIFF scan passes through.
    return /jpe?g|png/.test(lower);
  }
  // Fall back to the extension when the stored MIME is missing or generic
  // (octet-stream is common on uploads from mobile).
  return /\.(pdf|jpe?g|png)$/i.test(name);
}

let cached_logo: Uint8Array | null = null;

/** The white CB lockup. Drawn on a navy plate — see drawCorner. */
export const LOGO_FILE = "CBLOGOWHITE.png";

/**
 * The CB mark, read from the repo at runtime.
 *
 * `public/CBLOGOWHITE.png` must stay committed — same constraint as the email
 * hero images ([[email_hero_images_must_be_committed]]): an asset that only
 * exists on someone's laptop makes the production path throw. A missing logo is
 * NOT fatal here; the tiled text alone still identifies the source.
 */
async function loadLogo(): Promise<Uint8Array | null> {
  if (cached_logo) return cached_logo;
  try {
    const file = path.join(process.cwd(), "public", LOGO_FILE);
    cached_logo = new Uint8Array(await readFile(file));
    return cached_logo;
  } catch (err) {
    console.error(`watermark: could not read public/${LOGO_FILE}:`, err);
    return null;
  }
}

const STAMP_TEXT = "CREDIT BANC";
const STAMP_SUBTEXT = "CONFIDENTIAL";

/**
 * Lay the mark across every page.
 *
 * EVERY page, deliberately. A stamp on page one is removed by dropping page one,
 * and a 12-month statement is mostly pages nobody checks.
 *
 * Diagonal, tiled, low opacity: it has to survive cropping and stay legible
 * without obscuring the figures underneath — a lender who cannot read the
 * balances will just ask for a clean copy, which defeats the point.
 */
async function stampPdf(pdf: PDFDocument): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo();
  const logo_image = logo ? await pdf.embedPng(logo).catch(() => null) : null;

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const diagonal = Math.sqrt(width * width + height * height);

    // Tile size scales with the page so A4 and US Letter both get ~3 rows.
    const step = diagonal / 3;
    const font_size = Math.max(14, Math.min(28, width / 22));

    for (let y = -height; y < height * 2; y += step) {
      for (let x = -width; x < width * 2; x += step) {
        page.drawText(STAMP_TEXT, {
          x,
          y,
          size: font_size,
          font,
          color: rgb(0.16, 0.72, 0.55), // cb mint
          opacity: 0.13,
          rotate: degrees(35),
        });
        page.drawText(STAMP_SUBTEXT, {
          x,
          y: y - font_size * 1.1,
          size: font_size * 0.6,
          font,
          color: rgb(0.05, 0.09, 0.2), // cb navy
          opacity: 0.11,
          rotate: degrees(35),
        });
      }
    }

    // One solid badge in the corner. The tiled text is deliberately faint so
    // the document stays readable; this is the part that reads as branding at a
    // glance, which is what makes a re-submitted packet obvious.
    //
    // The logo artwork is WHITE, so it has to sit on a dark plate or it simply
    // vanishes against the page — bank statements are white. The plate is the
    // brand navy at high opacity, which also makes the badge survive a
    // photocopy or a screenshot far better than a translucent mark would.
    if (logo_image) {
      const logo_width = Math.min(96, width * 0.2);
      const logo_height = (logo_image.height / logo_image.width) * logo_width;
      const pad = logo_width * 0.12;
      const plate_w = logo_width + pad * 2;
      const plate_h = logo_height + pad * 2;
      const plate_x = width - plate_w - 14;
      const plate_y = 14;

      page.drawRectangle({
        x: plate_x,
        y: plate_y,
        width: plate_w,
        height: plate_h,
        color: rgb(0.02, 0.01, 0.13), // cb navy
        opacity: 0.88,
      });
      page.drawImage(logo_image, {
        x: plate_x + pad,
        y: plate_y + pad,
        width: logo_width,
        height: logo_height,
        opacity: 1,
      });
    }
  }
}

/**
 * Stamp raw PDF bytes and return the stamped bytes.
 *
 * Exported so the stamping can be exercised on its own — the storage plumbing
 * around it is the easy part; what has to be right is that the output is a
 * valid PDF with the mark on every page.
 */
export async function stampPdfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  await stampPdf(pdf);
  return pdf.save();
}

/**
 * Wrap an image in a single-page PDF sized to it, so it can carry the same
 * stamp. Converting the type is intentional: it avoids adding an image
 * processing dependency, and a lender packet is better off all-PDF anyway.
 */
async function imageToPdf(bytes: Uint8Array, mime: string, name: string): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  const is_png = mime.includes("png") || /\.png$/i.test(name);
  const image = is_png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return pdf;
}

export interface WatermarkResult {
  /** Storage path to serve — the stamped copy, or the original when we can't stamp. */
  path: string;
  stamped: boolean;
  /** True when this call did the work (rather than finding a cached copy). */
  generated: boolean;
}

/**
 * Return a stamped copy of one document, generating and caching it on first use.
 *
 * Never throws for a stampable-but-broken file: on any failure it falls back to
 * the ORIGINAL path. A lender seeing an unstamped document is a commercial
 * risk; a lender seeing an error page is a lost deal, and the packet was
 * already shared deliberately.
 */
export async function getWatermarkedPath(
  admin: SupabaseClient,
  doc: { storage_path: string; type?: string | null; name?: string | null }
): Promise<WatermarkResult> {
  const original = doc.storage_path;
  const name = doc.name ?? original;

  if (!isStampable(doc.type, name)) {
    return { path: original, stamped: false, generated: false };
  }

  const target = watermarkedPathFor(original);

  // Cache probe. `list` on the parent prefix is cheap and, unlike download,
  // doesn't pull the file into this function just to find out it exists.
  const last_slash = target.lastIndexOf("/");
  const dir = target.slice(0, last_slash);
  const base = target.slice(last_slash + 1);
  const { data: existing } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .list(dir, { search: base, limit: 1 });

  if (existing?.some((f) => f.name === base)) {
    return { path: target, stamped: true, generated: false };
  }

  try {
    const { data: blob, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(original);
    if (error || !blob) throw error ?? new Error("no data");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = (doc.type || "").toLowerCase();

    let pdf: PDFDocument;
    if (mime.includes("pdf") || /\.pdf$/i.test(name)) {
      // ignoreEncryption: some bank exports are "protected" with an empty owner
      // password. Refusing those would silently drop the most important
      // documents in the packet.
      pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } else {
      pdf = await imageToPdf(bytes, mime, name);
    }

    await stampPdf(pdf);
    const out = await pdf.save();

    const { error: upload_error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(target, out, { contentType: "application/pdf", upsert: true });

    if (upload_error) throw upload_error;

    return { path: target, stamped: true, generated: true };
  } catch (err: any) {
    // One line, not a dumped Response object. This fires per file, so on a
    // client whose storage folder is empty it would otherwise bury the logs in
    // 155 stack traces of the same thing.
    const reason = err?.message || err?.error || "unknown error";
    console.error(`watermark: serving original for ${original} — ${reason}`);
    return { path: original, stamped: false, generated: false };
  }
}
