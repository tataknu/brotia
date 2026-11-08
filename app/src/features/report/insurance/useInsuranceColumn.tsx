/**
 * Wires the report table's Insurance column (v1.1, ADR-0025): per-farm request state from the service, the cells,
 * the TOTAL cell and the request dialog. The page calls it unconditionally (hooks rule) and renders `modal`.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Country, InsuranceRequest, Portfolio } from '@/domain/types';
import { countryInfo } from '@/features/portfolios/portfolioModel';
import type { InsuranceColumn } from '../ReportTable';
import type { ReportRow } from '../reportModel';
import { InsuranceCell, InsuranceHeader } from './InsuranceCell';
import { InsuranceRequestModal } from './InsuranceRequestModal';
import { useInsuranceRequests } from './useInsuranceRequests';

export function useInsuranceColumn({
  portfolio,
  rows,
  asOf,
  countries,
}: {
  portfolio: Portfolio | undefined;
  rows: readonly ReportRow[];
  asOf: string | undefined;
  countries: readonly Country[] | undefined;
}) {
  const { byFarm, availability, onQueued } = useInsuranceRequests(portfolio?.id);
  const [dialog, setDialog] = useState<{
    farmId: string;
    existing: InsuranceRequest | null;
  } | null>(null);
  const close = useCallback(() => setDialog(null), []);

  const requested = rows.filter((r) => byFarm.has(r.farmId)).length;
  const column = useMemo<InsuranceColumn>(
    () => ({
      header: <InsuranceHeader />,
      render: (r) => (
        <InsuranceCell
          farmName={r.name}
          request={byFarm.get(r.farmId)}
          availability={availability}
          onRequest={() => setDialog({ farmId: r.farmId, existing: null })}
          onView={(x) => setDialog({ farmId: r.farmId, existing: x })}
        />
      ),
      total: requested > 0 ? `${requested} queued` : availability === 'offline' ? 'Live only' : null,
    }),
    [byFarm, availability, requested],
  );

  const row = dialog ? rows.find((r) => r.farmId === dialog.farmId) : undefined;
  const modal =
    dialog && portfolio && row && asOf ? (
      <InsuranceRequestModal
        key={`${dialog.farmId}:${dialog.existing?.id ?? 'new'}`}
        portfolio={portfolio}
        row={row}
        asOf={asOf}
        countryName={countryInfo(portfolio.country, countries).name}
        existing={dialog.existing}
        onClose={close}
        onQueued={onQueued}
      />
    ) : null;

  return { column, modal };
}
