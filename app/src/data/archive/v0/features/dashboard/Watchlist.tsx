import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, ChevronRight, ListFilter } from 'lucide-react';
import clsx from 'clsx';
import type { CropType, Portfolio, Tier } from '@/domain/types';
import { CROPS, TIERS } from '@/domain/types';
import { TIER_COLORS } from '@/shared/chartColors';
import { date, money, TIER_LABELS } from '@/shared/format';
import { Badge, Card, Select, TierBadge } from '@/shared/ui';
import { MeterBar } from './perils';
import { DEFAULT_WATCH_FILTER, filterAndSort, type WatchFilter, type WatchRow } from './watchlistModel';

export function Watchlist({ portfolio, rows }: { portfolio: Portfolio; rows: WatchRow[] }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<WatchFilter>(DEFAULT_WATCH_FILTER);
  const visible = useMemo(() => filterAndSort(rows, filter), [rows, filter]);
  const cur = portfolio.currency;

  const crops = useMemo(() => [...new Set(portfolio.farms.map((f) => f.crop))], [portfolio]);
  const set = (patch: Partial<WatchFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const go = (farmId: string) => navigate(`/portfolios/${portfolio.id}/farms/${farmId}`);

  return (
    <Card
      title="Watchlist"
      subtitle="Every farm ranked by climate stress against its own normal for this time of year."
      flush
      actions={
        <span className="text-sm tabular-nums text-muted">
          {visible.length} of {rows.length}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <ListFilter size={16} className="text-muted" aria-hidden />
        <Select
          aria-label="Filter by tier"
          className="w-40"
          value={filter.tier}
          onChange={(e) => set({ tier: e.target.value as Tier | 'all' })}
          options={[{ value: 'all', label: 'All tiers' }, ...TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))]}
        />
        <Select
          aria-label="Filter by crop"
          className="w-40"
          value={filter.crop}
          onChange={(e) => set({ crop: e.target.value as CropType | 'all' })}
          options={[{ value: 'all', label: 'All crops' }, ...crops.map((c) => ({ value: c, label: CROPS[c]?.label ?? c }))]}
        />
        <Select
          aria-label="Filter by zone"
          className="w-44"
          value={filter.zoneId}
          onChange={(e) => set({ zoneId: e.target.value })}
          options={[{ value: 'all', label: 'All zones' }, ...portfolio.zones.map((z) => ({ value: z.id, label: z.name }))]}
        />
        <div className="flex-1" />
        <div className="flex items-center gap-1 rounded-card border border-line p-0.5" role="group" aria-label="Sort">
          <ArrowUpDown size={16} className="mx-1.5 text-muted" aria-hidden />
          {(['score', 'exposure'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter.sortBy === k}
              onClick={() => set({ sortBy: k })}
              className={clsx('rounded-[6px] px-2.5 py-1 text-sm transition-colors', filter.sortBy === k ? 'bg-brand-soft font-medium text-brand-ink' : 'text-muted hover:text-ink')}
            >
              {k === 'score' ? 'Stress score' : 'Exposure'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="w-12 px-5 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">Farm</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="w-36 px-3 py-2.5 font-medium">Score</th>
              <th className="px-3 py-2.5 font-medium">Main reason</th>
              <th className="px-3 py-2.5 text-right font-medium">Exposure</th>
              <th className="px-3 py-2.5 font-medium">Next installment</th>
              <th className="w-8 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-muted">
                  No farms match these filters.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const a = r.assessment;
              return (
                <tr
                  key={r.farm.id}
                  tabIndex={0}
                  onClick={() => go(r.farm.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') go(r.farm.id);
                  }}
                  className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface focus:bg-surface focus:outline-none"
                >
                  <td className="px-5 py-3 tabular-nums text-muted">{r.rank}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-ink">{r.farm.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CROPS[r.farm.crop]?.color }} aria-hidden />
                      {CROPS[r.farm.crop]?.label ?? r.farm.crop}
                      {r.zone && <span className="truncate">· {r.zone.name}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <TierBadge tier={a.tier} />
                      {a.inStressWindow && <Badge tone="info">In stress window</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-7 text-right font-medium tabular-nums text-ink">{a.score}</span>
                      <MeterBar value={a.score} max={100} color={TIER_COLORS[a.tier].fg} label={`Stress score ${a.score} of 100`} />
                    </div>
                  </td>
                  <td className="max-w-[340px] px-3 py-3 text-ink">
                    <p className="line-clamp-2">{a.headline}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-ink">{money(a.exposure, cur)}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {a.nextInstallment ? (
                      <>
                        <div className="text-ink">{date(a.nextInstallment.dueDate)}</div>
                        <div className="text-muted">{money(a.nextInstallment.amount, cur)}</div>
                      </>
                    ) : (
                      <span className="text-muted">None due</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted">
                    <ChevronRight size={16} aria-hidden />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
