import type { FarmAssessment } from '@/domain/types';
import { PERILS } from '@/domain/types';
import { PERIL_COLORS } from '@/shared/chartColors';
import { number, PERIL_LABELS } from '@/shared/format';
import { Card } from '@/shared/ui';
import { MeterBar, PerilIcon } from '@/features/dashboard/perils';

function severityWord(s: number): string {
  if (s >= 0.66) return 'Severe';
  if (s >= 0.33) return 'Moderate';
  if (s > 0.05) return 'Mild';
  return 'None';
}

export function DriversList({ assessment }: { assessment: FarmAssessment }) {
  const drivers = assessment.drivers;
  return (
    <Card title="Why this score" subtitle="Each reason compares this field with its own normal for this time of year.">
      {drivers.length === 0 ? (
        <p className="text-sm text-muted">Nothing unusual: every signal is within this field’s normal range.</p>
      ) : (
        <ul className="space-y-4">
          {drivers.map((d, i) => (
            <li key={`${d.peril}-${d.metric}-${i}`} className="flex gap-3">
              <PerilIcon peril={d.peril} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{PERIL_LABELS[d.peril]}</span>
                  <span className="text-sm text-muted">{severityWord(d.severity)}</span>
                </div>
                <MeterBar className="mt-1.5" value={d.severity} color={PERIL_COLORS[d.peril]} label={`${PERIL_LABELS[d.peril]} severity`} />
                <p className="mt-1.5 text-sm text-ink">{d.text}</p>
                <p className="mt-0.5 text-sm tabular-nums text-muted">
                  {d.metric}: {number(d.value, Math.abs(d.value) < 10 ? 2 : 0)} vs normal {number(d.normal, Math.abs(d.normal) < 10 ? 2 : 0)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-medium text-ink">Peril breakdown</p>
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {PERILS.map((p) => (
            <div key={p} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-ink">{PERIL_LABELS[p]}</span>
              <MeterBar value={assessment.perils[p] ?? 0} color={PERIL_COLORS[p]} label={`${PERIL_LABELS[p]} risk`} />
              <span className="w-9 shrink-0 text-right tabular-nums text-muted">{number((assessment.perils[p] ?? 0) * 100, 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
