/**
 * Provenance UI (trust rule: every value shows where it came from).
 *
 * <ProvenanceBadge provenance={p} />        compact chip: short source + honest flags; click for details
 * <ProvenanceBadge provenance={p} iconOnly /> just an info icon (inline next to a number)
 * <ProvenancePopover provenance={p} />      the details panel content (source, observedAt, fetchedAt,
 *                                            resolution, licence tier, stale/estimated, data tier, note)
 */
import clsx from 'clsx';
import { Info } from 'lucide-react';
import type { Provenance } from '@/domain/types';
import { provenanceFlags, provenanceRows } from '@/shared/labels';
import { Badge } from './Badge';
import { Popover } from './Popover';
import { DataTierPill } from './DataTierPill';

export function ProvenancePopover({ provenance, title }: { provenance: Provenance; title?: string }) {
  const flags = provenanceFlags(provenance);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-ink">{title ?? 'Where this value comes from'}</p>
        <DataTierPill tier={provenance.dataTier} />
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge key={f.label} tone={f.tone} dot>
              {f.label}
            </Badge>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
        {provenanceRows(provenance).map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted">{r.label}</dt>
            <dd className="min-w-0 break-words text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      {provenance.note && <p className="rounded-card bg-surface px-3 py-2 text-muted">{provenance.note}</p>}
      <p className="font-mono text-xs text-muted">{provenance.source}</p>
    </div>
  );
}

export function ProvenanceBadge({
  provenance,
  iconOnly,
  title,
  className,
}: {
  provenance: Provenance | null | undefined;
  iconOnly?: boolean;
  /** Popover heading, e.g. 'Frost: coldest night'. */
  title?: string;
  className?: string;
}) {
  if (!provenance) return null;
  const flags = provenanceFlags(provenance);
  const worst = flags.find((f) => f.tone === 'danger') ?? flags.find((f) => f.tone === 'warn') ?? flags[0];
  const label = `Source: ${provenance.sourceLabel || provenance.source}${flags.length ? ` (${flags.map((f) => f.label.toLowerCase()).join(', ')})` : ''}`;
  return (
    <Popover
      label={label}
      className={clsx('max-w-full', className)}
      trigger={
        iconOnly ? (
          <span className={clsx('inline-flex p-0.5', worst?.tone === 'danger' ? 'text-danger' : worst?.tone === 'warn' ? 'text-warn' : 'text-muted hover:text-ink')}>
            <Info size={16} />
          </span>
        ) : (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-white px-2 py-0.5 text-xs text-muted hover:bg-surface hover:text-ink">
            <Info size={14} className="shrink-0" />
            <span className="truncate">{shortSource(provenance)}</span>
            {worst && <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', worst.tone === 'danger' ? 'bg-danger' : worst.tone === 'warn' ? 'bg-warn' : 'bg-[#2F5C8C]')} />}
            {worst && <span className="shrink-0">{worst.label}</span>}
          </span>
        )
      }
    >
      <ProvenancePopover provenance={provenance} title={title} />
    </Popover>
  );
}

/** 'CR2MET NRT (CR2, Univ. de Chile)' → 'CR2MET NRT'. */
function shortSource(p: Provenance): string {
  const s = p.sourceLabel || p.source;
  const i = s.indexOf(' (');
  return i > 0 ? s.slice(0, i) : s;
}
