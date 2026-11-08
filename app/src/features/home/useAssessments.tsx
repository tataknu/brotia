/**
 * One assessment per portfolio, fetched concurrently through the shared cache (usePortfolioAssessment).
 * Hooks cannot run in a loop of variable length, so each portfolio gets an invisible probe component that
 * reports its query state up. All probes mount together, so all requests start together; results are
 * shared with the portfolio report (same cache key).
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { UnavailableError, type DataSource } from '@/data/api';
import { usePortfolioAssessment } from '@/data/hooks';
import type { Portfolio, PortfolioAssessment } from '@/domain/types';

export type ProbeStatus = 'loading' | 'ready' | 'no_farms' | 'unavailable' | 'error';

export interface ProbeState {
  status: ProbeStatus;
  /** Present when status is 'ready' (also while a refetch runs). */
  assessment: PortfolioAssessment | null;
  source: DataSource | null;
  /** Offline snapshot date when source is 'snapshot'. */
  snapshotDate: string | null;
  /** Plain-language reason for 'unavailable' / 'error'. */
  reason: string | null;
  refreshing: boolean;
  refetch: (() => void) | null;
  /** Date.now() when the current wait began (status 'loading'); null otherwise. Lets the page say "still assessing". */
  since: number | null;
}

const initial = (p: Portfolio): ProbeState => ({
  status: p.farms.length === 0 ? 'no_farms' : 'loading',
  assessment: null,
  source: null,
  snapshotDate: null,
  reason: null,
  refreshing: false,
  refetch: null,
  since: null,
});

const Probe = memo(function Probe({ portfolio, onChange }: { portfolio: Portfolio; onChange: (id: string, s: ProbeState) => void }) {
  const { data, source, snapshotDate, error, loading, refetch } = usePortfolioAssessment(portfolio);
  const id = portfolio.id;
  const noFarms = portfolio.farms.length === 0;
  const since = useRef<number | null>(null);
  useEffect(() => {
    const assessment = data && data.portfolioId === id ? data : null;
    let status: ProbeStatus;
    if (noFarms) status = 'no_farms';
    else if (assessment) status = 'ready';
    else if (loading) status = 'loading';
    else if (error) status = error instanceof UnavailableError ? 'unavailable' : 'error';
    else status = 'loading';
    if (status !== 'loading') since.current = null;
    else if (since.current === null) since.current = Date.now();
    onChange(id, {
      status,
      assessment,
      source: assessment ? (source ?? null) : null,
      snapshotDate: assessment ? snapshotDate : null,
      reason: status === 'unavailable' || status === 'error' ? (error?.message ?? null) : null,
      refreshing: !!assessment && loading,
      refetch,
      since: since.current,
    });
  }, [id, noFarms, data, source, snapshotDate, error, loading, refetch, onChange]);
  return null;
});

/** States by portfolio id (every portfolio has one) and the probe elements to render once in the page. */
export function useAssessments(portfolios: readonly Portfolio[]): { states: Record<string, ProbeState>; probes: ReactNode } {
  const [reported, setReported] = useState<Record<string, ProbeState>>({});
  const onChange = useCallback((id: string, s: ProbeState) => setReported((prev) => ({ ...prev, [id]: s })), []);
  const states: Record<string, ProbeState> = {};
  for (const p of portfolios) states[p.id] = reported[p.id] ?? initial(p);
  const probes = portfolios.map((p) => <Probe key={p.id} portfolio={p} onChange={onChange} />);
  return { states, probes };
}
