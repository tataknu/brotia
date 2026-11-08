import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Calendar, Trash, Wheat } from 'lucide-react';
import type { Portfolio } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { AS_OF } from '@/data/api';
import { hectares, localDate, money } from '@/shared/format';
import { Button } from '@/shared/ui';
import { portfolioAreaHa, portfolioExposure } from '@/features/dashboard/watchlistModel';

export function PortfolioCard({ portfolio, onDelete }: { portfolio: Portfolio; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const summary = useMemo(() => {
    const crops = [...new Set(portfolio.farms.map((f) => f.crop))];
    return {
      exposure: portfolioExposure(portfolio, AS_OF),
      area: portfolioAreaHa(portfolio),
      crops: crops.map((c) => CROPS[c]?.label ?? c).join(', '),
    };
  }, [portfolio]);
  const to = `/portfolios/${portfolio.id}`;

  return (
    <div className="flex flex-col rounded-card border border-line bg-white shadow-panel transition-colors hover:border-brand/40">
      <Link to={to} className="flex-1 rounded-t-card px-5 pb-4 pt-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{portfolio.name}</h2>
            <p className="mt-0.5 truncate text-sm text-muted">{portfolio.lender || 'No lender set'}</p>
          </div>
          <ArrowRight size={16} className="mt-1 shrink-0 text-muted" aria-hidden />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-muted">Outstanding exposure</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{money(summary.exposure, portfolio.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Farms</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {portfolio.farms.length}
              <span className="ml-1.5 text-sm font-normal text-muted">{hectares(summary.area)}</span>
            </dd>
          </div>
        </dl>
        {summary.crops && (
          <p className="mt-3 flex items-center gap-1.5 truncate text-sm text-muted">
            <Wheat size={16} className="shrink-0" aria-hidden />
            <span className="truncate">{summary.crops}</span>
          </p>
        )}
      </Link>
      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-2.5">
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Calendar size={16} aria-hidden />
          Created {localDate(portfolio.createdAt)}
        </span>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink">Delete this portfolio?</span>
            <Button size="sm" variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" icon={<Trash size={16} />} onClick={() => setConfirming(true)} aria-label={`Delete ${portfolio.name}`}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
