/**
 * Sidebar badge: incidents in the last 24 h across every portfolio in the store. It reads the same cached
 * assessments as Home and the reports (useAssessments, one probe per portfolio; the query cache dedupes), and
 * counts with the same definition (badgeSummary → features/report/reportModel incidents()).
 */
import type { ReactNode } from 'react';
import { useStore } from '@/state/store';
import { useAssessments } from '@/features/home/useAssessments';
import { badgeSummary, type BadgeSummary } from './incidentsModel';

export function useIncidentBadge(): BadgeSummary & { probes: ReactNode } {
  const portfolios = useStore((s) => s.portfolios);
  const { states, probes } = useAssessments(portfolios);
  // A filter over each assessment's events; cheap enough to run on every render of the sidebar.
  const summary = badgeSummary(portfolios.map((p) => ({ portfolio: p, assessment: states[p.id]?.assessment ?? null })));
  return { ...summary, probes };
}
