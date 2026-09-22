import type { ClientFileTab } from "./capabilities";

export function resolveTab(raw: string | null | undefined, allowed: readonly ClientFileTab[]): ClientFileTab {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as ClientFileTab;
  return "overview";
}

export function withTabParam(search: string, tab: ClientFileTab): string {
  const params = new URLSearchParams(search);
  if (tab === "overview") params.delete("tab");
  else params.set("tab", tab);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
