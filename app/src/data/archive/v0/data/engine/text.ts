/** Small plain-language helpers for driver texts (kept local so src/data never depends on UI code). */
import type { Currency } from '@/domain/types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));

/** '2026-11-06' -> 'early November'. */
export function periodPhrase(iso: string): string {
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const part = d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late';
  return `${part} ${MONTHS[m]}`;
}

/** '2026-10-21' -> 'Oct 21'. */
export function shortDate(iso: string): string {
  return `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

export function ordinal(n: number): string {
  const v = Math.round(n);
  const s = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th';
  return `${v}${s}`;
}

export function compactMoney(n: number, currency: Currency): string {
  const prefix = currency === 'USD' ? '$' : 'Bs ';
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${prefix}${Math.round(n / 1_000)}k`;
  return `${prefix}${Math.round(n)}`;
}

export const fmt0 = (n: number) => String(Math.round(n));
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const fmt2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
export const plural = (n: number, one: string, many: string) => (Math.round(n) === 1 ? one : many);
