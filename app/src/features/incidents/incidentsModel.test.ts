import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe as group, expect, it } from 'vitest';
import type { ClimateEvent, Portfolio, PortfolioAssessment } from '@/domain/types';
import { incidents, nearbyEventCount } from '@/features/report/reportModel';
import {
  allRows,
  applyFilters,
  badgeSummary,
  DEFAULT_FILTERS,
  farmHref,
  filtersToParams,
  groupBySeverity,
  nearbyCount,
  parseFilters,
  plainEventTitle,
  severityOf,
  windowHours,
  type PortfolioEntry,
} from './incidentsModel';

/** The exported 12-farm offline snapshot (real service output, as-of 7 Nov 2026). */
const snap = <T,>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/snapshot/${name}`, import.meta.url)), 'utf8')) as T;
const a = snap<PortfolioAssessment>('assessment-portfolio.json');
const portfolio = snap<Portfolio>('portfolio.json');
const sample: PortfolioEntry = { portfolio, assessment: a };

const event = (over: Partial<ClimateEvent>): ClimateEvent => ({
  id: 'x:1',
  kind: 'fire',
  title: 'Fire',
  region: 'R',
  start: '2026-11-07',
  end: null,
  severity: 'moderate',
  source: 'S',
  evidenceKind: 'observed_footprint',
  affectedFarmIds: [],
  affectedExposure: 0,
  provenance: { source: 's', sourceLabel: 'S', observedAt: null, fetchedAt: '2026-11-07T00:00:00Z', resolution: 'n/a', licenceTier: 'commercial_ok', dataTier: 'standard', stale: false, estimated: false } as ClimateEvent['provenance'],
  ...over,
});

group('incidents across portfolios', () => {
  it('matches the report KPI on the sample: 6 in 24 h, 85 nearby events touching no farm', () => {
    const rows = allRows([sample], '24h');
    expect(rows).toHaveLength(incidents(a).length);
    expect(rows).toHaveLength(6);
    expect(nearbyCount([sample], DEFAULT_FILTERS)).toBe(nearbyEventCount(a));
    expect(nearbyCount([sample], DEFAULT_FILTERS)).toBe(85);
  });

  it('groups critical, then warning, then events', () => {
    const groups = groupBySeverity(allRows([sample], '24h'));
    expect(groups.map((g) => [g.id, g.rows.length])).toEqual([
      ['critical', 1],
      ['warning', 4],
      ['event', 1],
    ]);
    expect(groups[0].rows[0]).toMatchObject({ headline: 'Risk score 80 or more', detail: 'Open a restructuring review', farms: [{ id: 'cl-ovalle-table-grape' }] });
    // Inside warning: field visits before watches.
    expect(groups[1].rows.map((r) => r.incident.action)).toEqual(['field_visit', 'field_visit', 'watch', 'watch']);
    expect(groups[2].rows[0]).toMatchObject({ headline: 'Active fire detected near Romeral', farms: [{ id: 'cl-curico-cherry', name: expect.stringMatching(/Curic/) }] });
    expect(groups[2].rows[0].detail).toContain('VIIRS');
  });

  it('classifies severity from the fired action', () => {
    expect(severityOf({ kind: 'credit_rule', action: 'restructure_review' })).toBe('critical');
    expect(severityOf({ kind: 'credit_rule', action: 'high' })).toBe('critical');
    expect(severityOf({ kind: 'credit_rule', action: 'field_visit' })).toBe('warning');
    expect(severityOf({ kind: 'credit_rule', action: 'watch' })).toBe('warning');
    expect(severityOf({ kind: 'event' })).toBe('event');
  });

  it('skips portfolios without an assessment and keeps keys unique across portfolios', () => {
    const copy: PortfolioEntry = { portfolio: { ...portfolio, id: 'copy', name: 'Copy' }, assessment: { ...a, portfolioId: 'copy' } };
    const pending: PortfolioEntry = { portfolio: { ...portfolio, id: 'pending' }, assessment: null };
    const rows = allRows([sample, copy, pending], '24h');
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.key)).size).toBe(12);
    expect(nearbyCount([sample, copy, pending], DEFAULT_FILTERS)).toBe(170);
  });
});

group('widening the window', () => {
  it('uses the same definition with more hours', () => {
    expect([windowHours('24h'), windowHours('7d'), windowHours('30d')]).toEqual([24, 168, 720]);
    for (const w of ['24h', '7d', '30d'] as const) {
      expect(allRows([sample], w)).toHaveLength(incidents(a, { hours: windowHours(w) }).length);
      expect(nearbyCount([sample], { ...DEFAULT_FILTERS, window: w })).toBe(nearbyEventCount(a, windowHours(w)));
    }
  });

  it('only adds events: rules are dated the as-of, so they are in every window', () => {
    const count = (w: '24h' | '7d' | '30d', kind: 'event' | 'credit_rule') => applyFilters(allRows([sample], w), { portfolio: 'all', kind }).length;
    expect([count('24h', 'event'), count('7d', 'event'), count('30d', 'event')]).toEqual([1, 3, 3]);
    expect([count('24h', 'credit_rule'), count('7d', 'credit_rule'), count('30d', 'credit_rule')]).toEqual([5, 5, 5]);
    expect([85, 190, 211]).toEqual((['24h', '7d', '30d'] as const).map((w) => nearbyCount([sample], { ...DEFAULT_FILTERS, window: w })));
  });

  it('counts back whole days from the as-of and never forward', () => {
    const asOf = '2026-11-07';
    const e = (start: string) => event({ id: start, start, affectedFarmIds: ['f'] });
    const input: PortfolioEntry = {
      portfolio: { id: 'p', name: 'P', currency: 'USD', farms: [] },
      assessment: { portfolioId: 'p', asOf, creditActions: [], ranked: [], events: ['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-10-31', '2026-10-30', '2026-10-08', '2026-10-07'].map(e) },
    };
    const ids = (w: '24h' | '7d' | '30d') => allRows([input], w).map((r) => r.incident.id).sort();
    expect(ids('24h')).toEqual(['2026-11-06', '2026-11-07']);
    expect(ids('7d')).toEqual(['2026-10-31', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(ids('30d')).toEqual(['2026-10-08', '2026-10-30', '2026-10-31', '2026-11-05', '2026-11-06', '2026-11-07']);
  });
});

group('filters', () => {
  const copy: PortfolioEntry = { portfolio: { ...portfolio, id: 'copy', name: 'Copy' }, assessment: { ...a, portfolioId: 'copy', creditActions: [] } };
  const rows = allRows([sample, copy], '24h');

  it('filters by portfolio and by kind', () => {
    expect(applyFilters(rows, { portfolio: 'all', kind: 'all' })).toHaveLength(7);
    expect(applyFilters(rows, { portfolio: 'copy', kind: 'all' }).map((r) => r.incident.kind)).toEqual(['event']);
    expect(applyFilters(rows, { portfolio: portfolio.id, kind: 'credit_rule' })).toHaveLength(5);
    expect(applyFilters(rows, { portfolio: 'all', kind: 'event' })).toHaveLength(2);
  });

  it('counts nearby events for the selected portfolio, and none when only rules are shown', () => {
    expect(nearbyCount([sample, copy], { ...DEFAULT_FILTERS, portfolio: 'copy' })).toBe(85);
    expect(nearbyCount([sample, copy], { ...DEFAULT_FILTERS, kind: 'credit_rule' })).toBe(0);
  });

  it('reads and writes the URL, defaulting unknown values', () => {
    const ids = [portfolio.id];
    expect(parseFilters(new URLSearchParams(''), ids)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(new URLSearchParams(`window=7d&portfolio=${portfolio.id}&kind=event`), ids)).toEqual({ window: '7d', portfolio: portfolio.id, kind: 'event' });
    expect(parseFilters(new URLSearchParams('window=1y&portfolio=gone&kind=x'), ids)).toEqual(DEFAULT_FILTERS);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(filtersToParams({ window: '30d', portfolio: 'p1', kind: 'credit_rule' }).toString()).toBe('window=30d&portfolio=p1&kind=credit_rule');
  });
});

group('sidebar badge and links', () => {
  it('counts the last 24 h and turns danger when any incident is critical', () => {
    expect(badgeSummary([sample])).toEqual({ count: 6, tone: 'danger' });
    const noCritical: PortfolioEntry = { portfolio, assessment: { ...a, creditActions: a.creditActions.filter((c) => c.action !== 'restructure_review') } };
    expect(badgeSummary([noCritical])).toEqual({ count: 5, tone: 'warn' });
    expect(badgeSummary([{ portfolio, assessment: null }])).toEqual({ count: 0, tone: null });
  });

  it('links events to the farm Events tab and credit rules to its Overview', () => {
    const [crit, , , , , ev] = allRows([sample], '24h');
    expect(farmHref(crit, 'cl-ovalle-table-grape')).toBe(`/portfolios/${portfolio.id}/farms/cl-ovalle-table-grape`);
    expect(farmHref(ev, 'cl-curico-cherry')).toBe(`/portfolios/${portfolio.id}/farms/cl-curico-cherry?tab=events`);
  });

  it('moves the sensor detail out of the event headline', () => {
    expect(plainEventTitle('Active fire detected near Paine (1 VIIRS detection, max FRP 2.9 MW)')).toEqual({ headline: 'Active fire detected near Paine', note: '1 VIIRS detection, max FRP 2.9 MW' });
    expect(plainEventTitle('Water-scarcity decree No. 177 (Limarí province)').headline).toBe('Water-scarcity decree No. 177');
    expect(plainEventTitle('Flood warning')).toEqual({ headline: 'Flood warning', note: null });
  });
});
