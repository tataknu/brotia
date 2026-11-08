/**
 * Portfolios list (/portfolios): start a new portfolio (wizard) and open stored portfolios. The sample portfolios are
 * loaded on the first app start (state/samples.ts, ADR-0026 D6); a small "Restore sample portfolios" link at the bottom
 * adds back any sample that was deleted (never replaces a stored one). A finance-style table shows each portfolio's country, data tier,
 * crops, farms and loan book (lender inputs; risk numbers live on each portfolio's report).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FilePlus2, FolderOpen, Globe2, PencilLine, Trash2 } from 'lucide-react';
import { CROP_META } from '@/domain/constants';
import { UnavailableError } from '@/data/api';
import { loadMissingSamples } from '@/state/samples';
import { useConnection, useCountries } from '@/data/hooks';
import { todayUTC } from '@/domain/dates';
import type { Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { Button, DataTierPill, EmptyState, Modal, PortfolioName, buttonClass } from '@/shared/ui';
import { date, hectares, localDate, money } from '@/shared/format';
import { countryInfo, sortPortfolios, summarise, type PortfolioSummary } from './portfolioModel';

export function PortfoliosPage() {
  const portfolios = useStore((s) => s.portfolios);
  const draft = useStore((s) => s.draft);
  const deletePortfolio = useStore((s) => s.deletePortfolio);
  const { data: countries } = useCountries();
  const { mode, manifest } = useConnection();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Portfolio | null>(null);

  const sorted = useMemo(() => sortPortfolios(portfolios), [portfolios]);
  const asOf = todayUTC();

  /** Adds back every sample that is not stored (live service, or the offline snapshot). Stays on this page. */
  const restore = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const n = await loadMissingSamples();
      setMsg({ tone: 'info', text: n === 0 ? 'The sample portfolios are already here.' : `Restored ${n === 1 ? 'one sample portfolio' : `${n} sample portfolios`}.` });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof UnavailableError ? e.reason : `Could not restore the sample portfolios: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Portfolios</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            Loans on fruit and nut orchards, checked against climate stress at each farm&apos;s growth stage. Open a portfolio to see which loans are
            under stress, why, and how much money is exposed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && (
            <Link className={buttonClass('secondary', 'md')} to="/portfolios/new">
              <PencilLine size={16} />
              Continue draft
            </Link>
          )}
          <Link className={buttonClass('primary', 'md')} to="/portfolios/new">
            <FilePlus2 size={16} />
            New portfolio
          </Link>
        </div>
      </div>

      {/* Stored portfolios */}
      <section className="mt-10" aria-labelledby="your-portfolios">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="your-portfolios" className="text-base font-semibold text-ink">
            Your portfolios
          </h2>
          {sorted.length > 0 && (
            <span className="text-xs text-muted">
              Outstanding as of <span className="font-mono">{date(asOf)}</span>
            </span>
          )}
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon={<FolderOpen size={18} />}
            title="No portfolios yet"
            description="Create a new portfolio: pick a country, draw or pick farms from the CIREN orchard cadastre, add loans and rules."
            action={
              <Link className={buttonClass('primary', 'sm')} to="/portfolios/new">
                New portfolio
              </Link>
            }
          />
        ) : (
          <PortfolioTable portfolios={sorted} asOf={asOf} countries={countries} onDelete={setConfirmDelete} />
        )}
      </section>

      <div className="mt-8 border-t border-line pt-4 text-xs text-muted">
        <button
          type="button"
          disabled={loading}
          onClick={() => void restore()}
          className="rounded text-muted underline-offset-2 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-60"
        >
          {loading ? 'Restoring sample portfolios…' : 'Restore sample portfolios'}
        </button>
        {mode === 'snapshot' && !manifest && <span className="ml-2 text-warn-ink">Offline and no snapshot exported: the samples need the live service.</span>}
        {msg && <p className={msg.tone === 'error' ? 'mt-2 text-danger-ink' : 'mt-2'}>{msg.text}</p>}
      </div>

      {confirmDelete && (
        <Modal
          title="Delete this portfolio?"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deletePortfolio(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            “{confirmDelete.name}” and its audit trail are removed from this browser. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

const TH = 'px-3 py-2.5 text-left text-xs font-medium text-muted whitespace-nowrap';
const THR = `${TH} text-right`;
const TD = 'px-3 py-3 align-middle';
const TDN = `${TD} text-right font-mono text-[13px] font-medium text-ink whitespace-nowrap`;

function PortfolioTable({
  portfolios,
  asOf,
  countries,
  onDelete,
}: {
  portfolios: Portfolio[];
  asOf: string;
  countries: Parameters<typeof countryInfo>[1];
  onDelete: (p: Portfolio) => void;
}) {
  const rows = portfolios.map((p) => ({ p, c: countryInfo(p.country, countries), s: summarise(p, asOf) }));
  // A total only makes sense in one currency.
  const currency = rows[0]?.s.currency;
  const total =
    rows.length > 1 && rows.every((r) => r.s.currency === currency)
      ? rows.reduce(
          (t, r) => ({ farms: t.farms + r.s.farms, areaHa: t.areaHa + r.s.areaHa, loans: t.loans + r.s.loans, principal: t.principal + r.s.principal, outstanding: t.outstanding + r.s.outstanding }),
          { farms: 0, areaHa: 0, loans: 0, principal: 0, outstanding: 0 },
        )
      : null;

  return (
    <div className="relative mt-3 overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead className="border-b border-line bg-surface">
          <tr>
            <th scope="col" className={TH}>
              Portfolio
            </th>
            <th scope="col" className={TH}>
              Crops
            </th>
            <th scope="col" className={THR}>
              Farms
            </th>
            <th scope="col" className={THR}>
              Area
            </th>
            <th scope="col" className={THR}>
              Loans
            </th>
            <th scope="col" className={THR}>
              Principal
            </th>
            <th scope="col" className={THR}>
              Outstanding
            </th>
            <th scope="col" className={THR}>
              Rule edits
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, c, s }, i) => (
            <PortfolioRow key={p.id} portfolio={p} country={c} summary={s} zebra={i % 2 === 1} onDelete={() => onDelete(p)} />
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="border-t-[3px] border-double border-brand bg-white">
              <th scope="row" className={`${TD} text-left text-xs font-semibold uppercase tracking-wider text-ink`}>
                Total
              </th>
              <td className={TD} />
              <td className={TDN}>{total.farms}</td>
              <td className={TDN}>{hectares(total.areaHa)}</td>
              <td className={TDN}>{total.loans}</td>
              <td className={TDN}>{money(total.principal, currency, { compact: true })}</td>
              <td className={`${TDN} font-semibold`}>{money(total.outstanding, currency, { compact: true })}</td>
              <td className={TD} />
              <td className={TD} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function PortfolioRow({
  portfolio,
  country: c,
  summary: s,
  zebra,
  onDelete,
}: {
  portfolio: Portfolio;
  country: ReturnType<typeof countryInfo>;
  summary: PortfolioSummary;
  zebra: boolean;
  onDelete: () => void;
}) {
  const name = portfolio.name || 'Untitled portfolio';
  return (
    <tr className={zebra ? 'border-b border-line bg-surface/60 last:border-b-0' : 'border-b border-line bg-white last:border-b-0'}>
      <th scope="row" className={`${TD} text-left font-normal`}>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-white text-base leading-none" title={c.name} aria-hidden>
            {c.flag || <Globe2 size={16} />}
          </span>
          <div className="min-w-0">
            <Link to={`/portfolios/${portfolio.id}`} className="block max-w-[260px] truncate font-medium text-ink hover:text-brand focus:outline-none focus-visible:underline">
              <PortfolioName name={portfolio.name} code={portfolio.code} />
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span>
                {c.name}
                {portfolio.lender ? ` · ${portfolio.lender}` : ''}
                {` · created ${localDate(portfolio.createdAt)}`}
              </span>
              <DataTierPill tier={c.dataTier} className="!px-1.5 !py-0 text-[11px]" />
            </div>
          </div>
        </div>
      </th>
      <td className={TD}>
        <CropSummary crops={s.crops} />
      </td>
      <td className={TDN}>{s.farms}</td>
      <td className={TDN}>{hectares(s.areaHa)}</td>
      <td className={TDN}>{s.loans}</td>
      <td className={TDN}>{money(s.principal, s.currency, { compact: true })}</td>
      <td className={`${TDN} font-semibold`}>{money(s.outstanding, s.currency, { compact: true })}</td>
      <td className={TDN}>{s.rulesEdited}</td>
      <td className={`${TD} whitespace-nowrap text-right`}>
        <div className="flex items-center justify-end gap-1">
          <Link to={`/portfolios/${portfolio.id}`} className={buttonClass('secondary', 'sm')} aria-label={`Open ${name}`}>
            Open
            <ArrowRight size={16} />
          </Link>
          <button
            type="button"
            className="rounded-card p-1.5 text-muted hover:bg-danger-soft hover:text-danger-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            aria-label={`Delete ${portfolio.name}`}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

/** One line: a colour dot per crop, then the first two names and "+N". The full list is in the title. */
function CropSummary({ crops }: { crops: PortfolioSummary['crops'] }) {
  if (crops.length === 0) return <span className="text-xs text-muted">–</span>;
  const names = crops.map((c) => CROP_META[c].label);
  const shown = names.slice(0, 2).join(', ');
  return (
    <div className="flex items-center gap-2 whitespace-nowrap" title={names.join(', ')}>
      <span className="flex shrink-0 -space-x-0.5" aria-hidden>
        {crops.map((c) => (
          <span key={c} className="h-2 w-2 rounded-full ring-2 ring-white" style={{ background: CROP_META[c].color }} />
        ))}
      </span>
      <span className="text-xs text-ink">
        {shown}
        {names.length > 2 && <span className="text-muted"> +{names.length - 2}</span>}
      </span>
      <span className="sr-only">Crops: {names.join(', ')}</span>
    </div>
  );
}
