/**
 * Pure label logic for provenance and imagery frames (CONTRACT §E.12 labels). No React: unit-tested.
 */
import type { ImageryFrame, Provenance } from '@/domain/types';
import type { BadgeTone } from './ui/Badge';
import { DATA_TIER_LABELS, LICENCE_LABELS, date, timestampUTC } from './format';

export interface Flag {
  label: string;
  tone: BadgeTone;
  hint: string;
}

/** Honest flags for a provenance: stale, estimated, demo-only / unresolved licence, unavailable. */
export function provenanceFlags(p: Provenance): Flag[] {
  const out: Flag[] = [];
  // A lender declaration has no observation date: it is present, not unavailable.
  if (p.observedAt === null && p.source !== 'lender') out.push({ label: 'Unavailable', tone: 'danger', hint: p.note || 'The source returned no observation.' });
  if (p.stale) out.push({ label: 'Stale', tone: 'warn', hint: 'Served from cache after a failed refresh.' });
  if (p.estimated) out.push({ label: 'Estimated', tone: 'info', hint: 'Produced by a fallback, gap-fill, interpolation or proxy.' });
  if (p.licenceTier === 'demo_only') out.push({ label: 'Demo only', tone: 'warn', hint: LICENCE_LABELS.demo_only });
  if (p.licenceTier === 'unresolved') out.push({ label: 'Licence unresolved', tone: 'neutral', hint: LICENCE_LABELS.unresolved });
  return out;
}

/** Rows for the provenance popover, in display order. */
export function provenanceRows(p: Provenance): { label: string; value: string }[] {
  return [
    { label: 'Source', value: p.sourceLabel || p.source },
    { label: 'Observed', value: p.observedAt ? (p.observedAt.length > 10 ? timestampUTC(p.observedAt) : date(p.observedAt)) : 'Not available' },
    { label: 'Fetched', value: timestampUTC(p.fetchedAt) },
    { label: 'Resolution', value: p.resolution },
    { label: 'Licence', value: LICENCE_LABELS[p.licenceTier] },
    { label: 'Data tier', value: DATA_TIER_LABELS[p.dataTier] },
    { label: 'Stale', value: p.stale ? 'Yes, served from cache' : 'No' },
    { label: 'Estimated', value: p.estimated ? 'Yes' : 'No' },
  ];
}

export type FrameKind = 'observed' | 'interpolated' | 'ai' | 'resampled';

/** "Observed" / "Interpolated (n days from a clear image)" (CONTRACT §E.12). */
export function frameKindLabel(frame: Pick<ImageryFrame, 'kind' | 'daysToClear'>): string {
  if (frame.kind === 'observed') return 'Observed';
  const n = Math.round(frame.daysToClear);
  return `Interpolated (${n} ${n === 1 ? 'day' : 'days'} from a clear image)`;
}

/** "AI-enhanced" / "Resampled, not AI" / null (native pixels only). */
export function srLabel(srKind: ImageryFrame['srKind'] | undefined): string | null {
  if (srKind === 'ai') return 'AI-enhanced';
  if (srKind === 'resampled') return 'Resampled, not AI';
  return null;
}

/** Confidence of an interpolated frame from its distance to a clear observation. */
export function frameConfidence(daysToClear: number): 'high' | 'medium' | 'low' {
  if (daysToClear <= 5) return 'high';
  if (daysToClear <= 15) return 'medium';
  return 'low';
}
