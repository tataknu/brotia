/**
 * Warm-up for the platform while the presentation plays: loads the sample portfolios, then mounts the same hidden
 * assessment probes Home uses, so the shared query cache (data/hooks.ts) already holds every portfolio assessment and
 * the country list when "Enter platform" lands on Home. Renders nothing visible.
 */
import { useEffect } from 'react';
import { useCountries } from '@/data/hooks';
import { useAssessments } from '@/features/home/useAssessments';
import { bootstrapSamples } from '@/state/samples';
import { useStore } from '@/state/store';

export function WarmUp() {
  const portfolios = useStore((s) => s.portfolios);
  const { probes } = useAssessments(portfolios);
  useCountries();
  useEffect(() => {
    void bootstrapSamples();
  }, []);
  return <div hidden aria-hidden="true">{probes}</div>;
}
