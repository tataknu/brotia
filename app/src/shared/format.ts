import type { CreditAction, Currency, DataTier, LicenceTier, Peril, Tier } from '@/domain/types';

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Money in the portfolio currency (no FX in v1). compact=true gives "$1.2M" / "CLP 340k". */
export function money(n: number | null | undefined, currency: Currency = 'USD', opts?: { compact?: boolean }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  if (opts?.compact) {
    const s = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    return currency === 'USD' ? `$${s}` : `CLP ${s}`;
  }
  if (currency === 'USD') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  return `CLP ${nf0.format(n)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> 'Nov 6, 2026' (or 'Nov 2026' with style 'month', 'Nov 6' with 'short'). Timezone-safe. */
export function date(iso: string | undefined | null, style: 'long' | 'short' | 'month' = 'long'): string {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m) return iso;
  const mon = MONTHS[m - 1];
  if (style === 'month') return `${mon} ${y}`;
  if (style === 'short') return `${mon} ${d}`;
  return `${mon} ${d}, ${y}`;
}

/**
 * Calendar date of a moment, in the viewer's local time zone. Use for real timestamps such as
 * `createdAt` (stored as a UTC ISO string). Plain 'YYYY-MM-DD' domain dates are shown as-is.
 */
export function localDate(timestamp: string | undefined | null): string {
  if (!timestamp) return '–';
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return date(timestamp);
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return date(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

/** 0.234 -> '23%' (input is a fraction). Use pctPoints for values already in percent. */
export function pct(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '–';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function pctPoints(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '–';
  return `${value.toFixed(digits)}%`;
}

export function number(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function hectares(ha: number): string {
  return `${number(ha, ha < 100 ? 1 : 0)} ha`;
}

export const TIER_LABELS: Record<Tier, string> = { normal: 'Normal', watch: 'Watch', high: 'High stress' };

export const PERIL_LABELS: Record<Peril, string> = {
  frost: 'Frost',
  heat: 'Heat and sunburn',
  harvest_rain: 'Harvest rain',
  water: 'Water supply',
  chill: 'Low chill',
  fire: 'Fire',
  flood: 'Flood',
  declared_emergency: 'Declared emergency',
  abandonment: 'Abandonment',
  vigour: 'Vigour',
};

export const COMPONENT_LABELS: Record<'climate' | 'disaster' | 'geography', string> = {
  climate: 'Climate and water',
  disaster: 'Disasters',
  geography: 'Geography',
};

export const CREDIT_ACTION_LABELS: Record<CreditAction, string> = {
  watch: 'Watch',
  high: 'High',
  field_visit: 'Field visit',
  restructure_review: 'Restructure review',
};

export const LICENCE_LABELS: Record<LicenceTier, string> = {
  commercial_ok: 'Commercial use OK',
  demo_only: 'Demo only',
  unresolved: 'Licence unresolved',
};

export const DATA_TIER_LABELS: Record<DataTier, string> = {
  enhanced: 'Enhanced (national sources)',
  standard: 'Standard (global sources)',
};

/** Signed number with a real minus sign: -3.1 → '−3.1', 0.4 → '+0.4' (when signed). */
export function signed(n: number | null | undefined, digits = 1, opts?: { plus?: boolean }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const s = Math.abs(n).toFixed(digits);
  if (n < 0 && Number(s) !== 0) return `−${s}`;
  return opts?.plus && n > 0 ? `+${s}` : s;
}

/** Value with unit, '–' for null: unit(3.14, '°C') → '3.1 °C'; unit(12, 'mm', 0) → '12 mm'. */
export function withUnit(n: number | null | undefined, unitLabel: string, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${signed(n, digits)} ${unitLabel}`;
}

/** ISO timestamp → 'Nov 7, 2026, 16:07 UTC' (UTC, unambiguous for provenance). */
export function timestampUTC(ts: string | null | undefined): string {
  if (!ts) return '–';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const iso = d.toISOString();
  return `${date(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC`;
}
