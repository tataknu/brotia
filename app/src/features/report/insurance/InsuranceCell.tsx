/**
 * The Insurance column: header with Suyana's logo mark, and one cell per farm: "Request", or "Requested · <date>"
 * with a "Queued" status chip (opens the queued request), or a disabled button offline.
 */
import { Clock } from 'lucide-react';
import type { InsuranceRequest } from '@/domain/types';
import { date } from '@/shared/format';
import { COPY, PARTNER, localDay } from './insuranceModel';
import type { InsuranceAvailability } from './useInsuranceRequests';

/** Suyana's logo mark (verbatim from suyana.io), 22 px in the column header. */
export function SuyanaMark({ size = 22 }: { size?: number }) {
  return <img src={PARTNER.logo} alt="" aria-hidden className="block shrink-0" width={size} height={size} style={{ width: size, height: size }} />;
}

export function InsuranceHeader() {
  return (
    <span className="-my-1 inline-flex items-center gap-2 leading-none" title="Insurance requests for Suyana, queued in BrotIA's outbox">
      <SuyanaMark />
      Insurance
      <span className="sr-only"> (Suyana)</span>
    </span>
  );
}

export function QueuedChip() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface px-1.5 py-px text-[11px] font-medium text-ink">
      <Clock size={11} className="text-muted" aria-hidden />
      Queued
    </span>
  );
}

const small =
  'inline-flex items-center rounded-card border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

export function InsuranceCell({
  farmName,
  request,
  availability,
  onRequest,
  onView,
}: {
  farmName: string;
  request: InsuranceRequest | undefined;
  availability: InsuranceAvailability;
  onRequest: () => void;
  onView: (r: InsuranceRequest) => void;
}) {
  if (request) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5 whitespace-nowrap">
        <button
          type="button"
          onClick={() => onView(request)}
          className="rounded text-[11px] text-ink underline decoration-line underline-offset-2 hover:text-brand hover:decoration-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          aria-label={`Insurance request for ${farmName}: requested ${date(localDay(request.createdAt))}, queued, not yet sent to Suyana. Show it.`}
        >
          Requested · <span className="font-mono tabular-nums">{date(localDay(request.createdAt), 'short')}</span>
        </button>
        <QueuedChip />
      </span>
    );
  }
  if (availability === 'offline') {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button type="button" disabled className={`${small} cursor-not-allowed border-line bg-white text-muted opacity-60`}>
          Request
        </button>
        <span className="max-w-[6.5rem] whitespace-normal text-[11px] leading-tight text-muted">{COPY.needsLive}</span>
      </span>
    );
  }
  const checking = availability === 'checking';
  return (
    <button
      type="button"
      onClick={onRequest}
      disabled={checking}
      className={`${small} border-brand/40 bg-white text-brand hover:bg-brand-soft disabled:cursor-wait disabled:opacity-50`}
      aria-label={`Request insurance for ${farmName} from Suyana`}
    >
      Request
    </button>
  );
}
