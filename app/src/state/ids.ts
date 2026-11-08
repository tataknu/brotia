/** Short unique ids. Uses crypto.randomUUID when available. */
export function newId(prefix: string): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  const raw = c && 'randomUUID' in c ? c.randomUUID().replace(/-/g, '').slice(0, 10) : Math.floor(Date.now() * 1000 + performance.now()).toString(36);
  return `${prefix}-${raw}`;
}
