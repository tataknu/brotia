/** Q&A slide helpers. Events whose target sits inside `[data-qa]` belong to the Q&A cards and must not drive the deck. */
type Closest = { closest?: (sel: string) => unknown };

export function isQaTarget(target: EventTarget | null | undefined): boolean {
  const el = target as Closest | null | undefined;
  return !!el && typeof el.closest === 'function' && !!el.closest('[data-qa]');
}

/** `?qa=N` (1-based) opens card N on load, for screenshot review. Returns a 0-based index or null. */
export function qaParam(search: string, count: number): number | null {
  const n = Number(new URLSearchParams(search).get('qa'));
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}
