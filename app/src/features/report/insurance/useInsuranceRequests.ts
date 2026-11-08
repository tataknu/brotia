/**
 * Per-farm insurance request status for one portfolio: GET /insurance/requests?portfolioId= on load (live only),
 * merged with the requests queued in this session so a row flips to "Requested" at once.
 */
import { useCallback, useMemo, useState } from 'react';
import { ApiRequestError, listInsuranceRequests } from '@/data/api';
import { invalidate, useConnection, useQuery } from '@/data/hooks';
import type { InsuranceRequest } from '@/domain/types';
import { latestByFarm, mergeRequests } from './insuranceModel';

/**
 * - checking:    the mode or the list is not known yet;
 * - live:        the list loaded;
 * - offline:     snapshot mode, requests need the live service;
 * - unsupported: the service answered 404 (it runs without the outbox router, e.g. before a restart);
 * - error:       any other failure reading the list.
 * Requests can be made in live, unsupported and error (a failed POST is shown in the dialog).
 */
export type InsuranceAvailability = 'checking' | 'live' | 'offline' | 'unsupported' | 'error';

export const insuranceKey = (portfolioId: string) => `insurance-requests:${portfolioId}`;

export function useInsuranceRequests(portfolioId: string | null | undefined) {
  const { mode } = useConnection();
  const key = portfolioId && mode === 'live' ? insuranceKey(portfolioId) : null;
  const q = useQuery<InsuranceRequest[]>(key, () => listInsuranceRequests(portfolioId!));
  const [local, setLocal] = useState<InsuranceRequest[]>([]);

  const all = useMemo(
    () =>
      mergeRequests(
        q.data,
        local.filter((r) => r.portfolioId === portfolioId),
      ),
    [q.data, local, portfolioId],
  );
  const byFarm = useMemo(() => latestByFarm(all), [all]);

  let availability: InsuranceAvailability;
  if (mode === 'snapshot') availability = 'offline';
  else if (mode !== 'live') availability = 'checking';
  else if (q.error) availability = q.error instanceof ApiRequestError && q.error.status === 404 ? 'unsupported' : 'error';
  else availability = q.data ? 'live' : 'checking';

  const onQueued = useCallback((r: InsuranceRequest) => {
    setLocal((l) => [r, ...l.filter((x) => x.id !== r.id)]);
    invalidate(insuranceKey(r.portfolioId));
  }, []);

  return { byFarm, availability, error: q.error, onQueued };
}
