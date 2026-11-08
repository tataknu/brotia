import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Currency } from '@/domain/types';
import { SEMANTIC, TIER_COLORS } from '@/shared/chartColors';
import { money, pct } from '@/shared/format';
import { Card } from '@/shared/ui';
import { share } from './watchlistModel';

export interface ExposureRow {
  label: string;
  exposure: number;
  stressedExposure: number;
}

const TOTAL_COLOR = '#B7C2BC';
const STRESSED_COLOR = TIER_COLORS.high.fg;

function ExposureTooltip({ active, payload, currency }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; currency: Currency }) {
  const row = payload?.[0]?.payload as ExposureRow | undefined;
  if (!active || !row) return null;
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">{row.label}</p>
      <p className="mt-1 tabular-nums text-ink">Total {money(row.exposure, currency)}</p>
      <p className="tabular-nums text-ink">
        Under stress {money(row.stressedExposure, currency)} <span className="text-muted">({pct(share(row.stressedExposure, row.exposure))})</span>
      </p>
    </div>
  );
}

export function ExposureChart({ title, rows, currency }: { title: string; rows: ExposureRow[]; currency: Currency }) {
  const height = Math.max(140, rows.length * 40 + 64);
  return (
    <Card title={title} subtitle="Outstanding principal, and the part on farms under climate stress (watch or high tier).">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No exposure yet.</p>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid horizontal={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(v: number) => money(v, currency, { compact: true })} tick={{ fill: SEMANTIC.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={96} tick={{ fill: SEMANTIC.ink, fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: SEMANTIC.surface }} content={(p) => <ExposureTooltip active={p.active} payload={p.payload as ReadonlyArray<{ payload?: unknown }>} currency={currency} />} />
              <Legend verticalAlign="top" align="left" iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} formatter={(value: string) => <span style={{ color: SEMANTIC.ink }}>{value}</span>} />
              <Bar dataKey="exposure" name="Total" fill={TOTAL_COLOR} radius={[0, 4, 4, 0]} maxBarSize={14} />
              <Bar dataKey="stressedExposure" name="Under stress" fill={STRESSED_COLOR} radius={[0, 4, 4, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
