// src/lib/clipboard.ts
//
// One copy-to-clipboard helper that survives a document which has lost focus.
//
// navigator.clipboard.writeText() rejects with NotAllowedError ("Document is
// not focused") whenever the page isn't the active document. That is rare for
// a plain click handler but routine when the copy happens AFTER an await: a
// server-action round-trip is long enough for the user to click devtools,
// another window, or another tab, and by the time the value comes back the
// write is no longer allowed. The legacy execCommand('copy') path carries no
// such requirement, so it stands in as the fallback.
//
// Returns a boolean instead of throwing — a failed copy is a "here, take it
// manually" moment for the caller, not an exception.

export async function copy_to_clipboard(text: string): Promise<boolean> {
  if (typeof document === 'undefined' || !text) return false;

  // Only attempt the modern API while the document actually holds focus,
  // otherwise it is a guaranteed rejection and a console error for nothing.
  if (navigator.clipboard && document.hasFocus()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through — the execCommand path may still work
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Must stay in the layout to be selectable — display:none / hidden
    // elements cannot hold a selection — so park it off-screen instead.
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
