/**
 * Presentational parts of the insurance email (no data fetching, no portal, so they render on the server in tests):
 * the envelope (To / From / Subject), the body (greeting, two or three sentences, the figure, the cover chips, key
 * facts, technical detail, sign-off, P.S.) and the attachments row.
 */
import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, FileJson, Loader2, Plus } from 'lucide-react';
import { INSURANCE_PERILS } from '@/domain/types';
import type { InsurancePeril, InsuranceRequestPayload } from '@/domain/types';
import { CropPill, Textarea } from '@/shared/ui';
import { PERIL_LABELS, date, hectares, number } from '@/shared/format';
import { TierChip } from '../parts';
import { EmailFigure } from './EmailFigure';
import type { EmailBody, FigureSpec } from './emailModel';
import { attachments } from './emailModel';
import { SuyanaMark } from './InsuranceCell';
import { INSURANCE_PERIL_LABELS, NOTE_MAX, latLng } from './insuranceModel';

const mono = 'font-mono tabular-nums';

/* ───────────────────────── envelope ───────────────────────── */

function EnvRow({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 border-t border-line py-1.5 first:border-t-0 ${className}`}>
      <dt className="w-14 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function Envelope({ lender, portfolioName, subject }: { lender: string; portfolioName: string; subject: string }) {
  return (
    <dl>
      <EnvRow label="To">
        <span className="flex min-w-0 items-center gap-2.5">
          <SuyanaMark size={36} />
          <span className="min-w-0 leading-tight">
            <span className="font-semibold">Suyana</span>
            <span className="text-muted"> · parametric climate insurance</span>
          </span>
        </span>
      </EnvRow>
      <EnvRow label="From">
        <span className="font-medium">{lender}</span>
        <span className="text-muted">, via BrotIA</span>
        <span className="hidden text-muted sm:inline"> · {portfolioName}</span>
      </EnvRow>
      <EnvRow label="Subject">
        <span className="font-semibold leading-snug" data-testid="insurance-subject">
          {subject}
        </span>
      </EnvRow>
    </dl>
  );
}

/* ───────────────────────── cover chips ───────────────────────── */

export function PerilChips({
  perils,
  suggested,
  uncovered,
  onToggle,
}: {
  perils: readonly InsurancePeril[];
  suggested: readonly InsurancePeril[];
  uncovered: InsuranceRequestPayload['uncoveredPerils'];
  /** Absent → read-only (a queued request). */
  onToggle?: (p: InsurancePeril) => void;
}) {
  const shown = onToggle ? INSURANCE_PERILS : perils;
  return (
    <div className="mt-3">
      <div role="group" aria-label="Perils to request cover for" className="flex flex-wrap items-center gap-1.5">
        {shown.map((p) => {
          const on = perils.includes(p);
          const sug = suggested.includes(p);
          const cls = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            on ? 'border-brand/50 bg-brand-soft text-brand-ink' : 'border-line bg-white text-muted'
          }`;
          const inner = (
            <>
              {on ? <Check size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
              {INSURANCE_PERIL_LABELS[p]}
              {sug && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Suggested from the farm's leading drivers">
                  <span className="sr-only"> (suggested from the farm's leading drivers)</span>
                </span>
              )}
            </>
          );
          return onToggle ? (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(p)}
              className={`${cls} transition-colors hover:border-brand/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}
            >
              {inner}
            </button>
          ) : (
            <span key={p} className={cls}>
              {inner}
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {onToggle && suggested.length > 0 && (
          <>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden />
            Suggested from the farm's leading drivers.{' '}
          </>
        )}
        {onToggle && perils.length === 0 && <span className="text-danger-ink">Choose at least one peril. </span>}
        {uncovered.length > 0 && <>Not offered as parametric cover: {uncovered.map((x) => PERIL_LABELS[x] ?? x).join(', ')}.</>}
      </p>
    </div>
  );
}

/* ───────────────────────── facts and detail ───────────────────────── */

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 sm:block sm:border-b-0 sm:py-1">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink sm:text-left">{children}</dd>
    </div>
  );
}

export function KeyFacts({ p, place }: { p: InsuranceRequestPayload; place: string }) {
  return (
    <section aria-label="Key facts" className="mt-5 rounded-card border border-line bg-surface/60 px-3.5 py-2.5">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Key facts</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-1">
        <Fact label="Crop">
          <CropPill crop={p.farm.crop} className="!px-1.5 !py-0 !text-[11px]" />
        </Fact>
        <Fact label="Area">
          <span className={mono}>{hectares(p.farm.areaHa)}</span>
        </Fact>
        <Fact label="Location">{place}</Fact>
        <Fact label="Centroid (lat, lng)">
          <span className={`${mono} text-[13px]`}>{latLng(p.farm.centroid)}</span>
        </Fact>
        <Fact label="Zone">{p.farm.zoneName}</Fact>
        <Fact label={`Risk score, ${date(p.risk.asOf, 'short')}`}>
          <span className="inline-flex items-center gap-1.5">
            <span className={`font-semibold ${mono}`}>{number(p.risk.score, 1)}</span>
            <TierChip tier={p.risk.tier} />
          </span>
        </Fact>
      </dl>
    </section>
  );
}

export function TechnicalDetail({ p }: { p: InsuranceRequestPayload }) {
  if (p.risk.drivers.length === 0) return null;
  return (
    <details className="group mt-3 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
        Technical detail: the {p.risk.drivers.length} leading drivers, as the service states them
      </summary>
      <ol className="mt-2 space-y-1.5 border-l-2 border-line pl-3 text-xs leading-relaxed text-ink">
        {p.risk.drivers.map((d, i) => (
          <li key={i}>
            <span className="font-semibold">{PERIL_LABELS[d.peril] ?? d.peril}.</span> {d.text}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ───────────────────────── attachments ───────────────────────── */

export function Attachments({ p }: { p: InsuranceRequestPayload }) {
  const list = attachments(p);
  const [open, setOpen] = useState<string | null>(null);
  const shown = list.find((a) => a.name === open);
  return (
    <section aria-label="Attachments" className="mt-5 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">Attachments</span>
        {list.map((a) => (
          <button
            key={a.name}
            type="button"
            aria-expanded={open === a.name}
            onClick={() => setOpen(open === a.name ? null : a.name)}
            title={a.holds}
            className={`inline-flex items-center gap-1 rounded-card border px-2 py-1 font-mono text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              open === a.name ? 'border-brand/50 bg-brand-soft text-brand-ink' : 'border-line bg-white text-ink hover:bg-surface'
            }`}
          >
            <FileJson size={12} className="text-muted" aria-hidden />
            {a.name}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">The queued request carries exactly this data. The figure is shown for your team and is not attached.</p>
      {shown && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-card border border-line bg-surface p-2.5 font-mono text-[11px] leading-snug text-ink">
          {JSON.stringify(shown.data, null, 2)}
        </pre>
      )}
    </section>
  );
}

/* ───────────────────────── the email ───────────────────────── */

export function EmailBodyView({
  p,
  body,
  place,
  figure,
  loading,
  failed,
  suggested,
  onToggle,
  note,
  onNote,
  signer,
}: {
  p: InsuranceRequestPayload;
  body: EmailBody;
  place: string;
  figure: FigureSpec | null;
  /** The farm assessment (verdict, next payment, figure) is still loading. */
  loading?: boolean;
  failed?: boolean;
  suggested: readonly InsurancePeril[];
  onToggle?: (x: InsurancePeril) => void;
  /** Compose: the P.S. text and its setter. View: the stored note is in p.note. */
  note?: string;
  onNote?: (v: string) => void;
  signer: string;
}) {
  return (
    <article className="text-[15px] leading-relaxed text-ink">
      <p>Hello Suyana team,</p>
      <p className="mt-3">
        {body.farm} {body.verdict && <span className="font-medium">{body.verdict}</span>}
      </p>
      {loading && (
        <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Reading the farm's assessment…
        </p>
      )}
      {failed && <p className="mt-2 text-xs text-muted">The farm's assessment could not be read; the request goes without its drivers.</p>}
      {figure && <EmailFigure spec={figure} />}
      <p className={figure ? '' : 'mt-3'}>{body.loan}</p>
      <p className="mt-3">{body.cover}</p>
      <PerilChips perils={p.perils} suggested={suggested} uncovered={p.uncoveredPerils} onToggle={onToggle} />
      <KeyFacts p={p} place={place} />
      <TechnicalDetail p={p} />
      <p className="mt-5">
        Kind regards,
        <br />
        <span className="font-medium">{signer}</span>
        <span className="text-muted">, via BrotIA</span>
      </p>
      {onNote ? (
        <div className="mt-4">
          <label htmlFor="insurance-note" className="text-sm font-medium text-ink">
            P.S. <span className="font-normal text-muted">(optional)</span>
          </label>
          <Textarea
            id="insurance-note"
            className="mt-1 !min-h-[64px]"
            value={note ?? ''}
            maxLength={NOTE_MAX}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Anything your team wants Suyana to know."
            rows={2}
          />
        </div>
      ) : (
        p.note && (
          <p className="mt-4 whitespace-pre-wrap">
            <span className="font-medium">P.S.</span> {p.note}
          </p>
        )
      )}
      <Attachments p={p} />
    </article>
  );
}
