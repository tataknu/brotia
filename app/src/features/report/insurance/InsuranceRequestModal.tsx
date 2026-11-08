/**
 * Insurance request dialog (v1.1, ADR-0025), laid out as an email draft from the lender to Suyana: the envelope
 * (To / From / Subject) and the Send footer stay pinned, the body scrolls. The body says in plain words what the farm
 * looks like (the farm Overview's verdict), the loan and the cover asked for, with one small figure that supports it,
 * then the key facts, the perils as toggle chips, an optional P.S. and the attachments (the payload as queued).
 * Nothing is sent to Suyana: the copy says so before and after. Also shows an already queued request (view mode).
 */
import { useState } from 'react';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { ApiRequestError, NetworkError, UnavailableError, createInsuranceRequest } from '@/data/api';
import { useFarmAssessment } from '@/data/hooks';
import type { InsurancePeril, InsuranceRequest, Portfolio } from '@/domain/types';
import { Button } from '@/shared/ui';
import { date } from '@/shared/format';
import { farmRegion, type ReportRow } from '../reportModel';
import { QueuedChip } from './InsuranceCell';
import { EmailDialog } from './EmailDialog';
import { EmailBodyView, Envelope } from './EmailParts';
import { emailBody, farmVerdict, pickFigure, placeName, subjectLine } from './emailModel';
import { COPY, buildPayload, defaultPerils, localDay, togglePeril, topDrivers } from './insuranceModel';

function errorText(e: unknown): string {
  if (e instanceof UnavailableError) return `${e.reason}. Nothing was queued.`;
  if (e instanceof NetworkError) return 'Cannot reach the service. Nothing was queued.';
  if (e instanceof ApiRequestError) {
    if (e.status === 404) return 'The running service has no insurance outbox yet (it needs a restart). Nothing was queued.';
    return `The service refused the request (${e.code}: ${e.detail}). Nothing was queued.`;
  }
  return `The request failed (${(e as Error)?.message ?? 'unknown error'}). Nothing was queued.`;
}

export function InsuranceRequestModal({
  portfolio,
  row,
  asOf,
  countryName,
  existing,
  onClose,
  onQueued,
}: {
  portfolio: Portfolio;
  row: ReportRow;
  asOf: string;
  countryName: string;
  /** View mode: an already queued request. */
  existing?: InsuranceRequest | null;
  onClose: () => void;
  onQueued: (r: InsuranceRequest) => void;
}) {
  const farm = portfolio.farms.find((f) => f.id === row.farmId);
  // Compose: the same cache key as the report's per-farm lookups, so this is usually instant. View: the assessment on
  // the request's own as-of, so the verdict and the figure match what was queued.
  const viewAsOf = existing && existing.payload.risk.asOf !== asOf ? existing.payload.risk.asOf : null;
  const fa = useFarmAssessment(farm ? portfolio : null, row.farmId, viewAsOf);
  const [picked, setPicked] = useState<InsurancePeril[] | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<InsuranceRequest | null>(existing ?? null);

  const title = `Insurance request · ${row.name}`;
  const place = placeName(farm ? farmRegion(farm) : null, countryName);
  const assessment = fa.data ?? null;
  const loading = fa.loading && !fa.data;

  // ── the payload: as queued, or as it would be queued now ──
  const drivers = assessment ? topDrivers(assessment.risk.drivers) : [];
  const suggested = defaultPerils(drivers);
  const perils = picked ?? suggested;
  const payload = queued ? queued.payload : farm ? buildPayload({ portfolio, farm, row, asOf, drivers, perils, note }) : null;

  if (!payload) {
    return (
      <EmailDialog
        title={title}
        heading="Insurance request"
        envelope={<p className="text-sm text-muted">{row.name}</p>}
        onClose={onClose}
        footer={
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted">This farm is not in the portfolio any more.</p>
      </EmailDialog>
    );
  }

  const verdict = farmVerdict(assessment, payload.farm.crop);
  const body = emailBody(payload, place, {
    verdict,
    next: assessment?.nextInstallment,
  });
  const figure = pickFigure(assessment);
  const envelope = <Envelope lender={payload.lender} portfolioName={payload.portfolioName} subject={subjectLine(payload, place)} />;

  // ── after sending, or an existing request ──
  if (queued) {
    return (
      <EmailDialog
        title={title}
        heading={
          <span className="inline-flex items-center gap-2">
            Cover request <QueuedChip />
          </span>
        }
        envelope={envelope}
        onClose={onClose}
        scrollKey={queued.id}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-xs text-muted">Queued {date(localDay(queued.createdAt))}. Your team forwards it to Suyana.</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        }
      >
        <div role="status" className="mb-4 flex items-start gap-2 rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <span>{COPY.queued(queued.id)}</span>
        </div>
        <EmailBodyView p={payload} body={body} place={place} figure={figure} loading={loading} suggested={[]} signer={payload.lender} />
      </EmailDialog>
    );
  }

  // ── compose ──
  const canSend = perils.length > 0 && !loading && !sending;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await createInsuranceRequest({
        portfolioId: portfolio.id,
        farmId: row.farmId,
        payload,
      });
      setQueued(res.data);
      onQueued(res.data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <EmailDialog
      title={title}
      heading="New cover request"
      envelope={envelope}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mb-2.5 flex items-start gap-2 rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-ink">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-xs leading-snug text-muted">{COPY.beforeSend}</p>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={send} disabled={!canSend} icon={sending ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                Send to Suyana
              </Button>
            </div>
          </div>
        </>
      }
    >
      <EmailBodyView
        p={payload}
        body={body}
        place={place}
        figure={figure}
        loading={loading}
        failed={!!fa.error && !fa.data}
        suggested={suggested}
        onToggle={(x) => setPicked(togglePeril(perils, x))}
        note={note}
        onNote={setNote}
        signer={payload.lender}
      />
    </EmailDialog>
  );
}
