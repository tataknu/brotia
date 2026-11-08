/** Server render of the portfolio report shell and its finance table (node). Effects (fetches) do not run in SSR. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Portfolio, PortfolioAssessment } from '@/domain/types';
import { useStore } from '@/state/store';
import { PortfolioReportPage } from './PortfolioReportPage';
import { ReportTable } from './ReportTable';
import { reportRows, reportTotals, sortRows, type FarmProbe, type SortState } from './reportModel';
import PaymentsTab from './tabs/PaymentsTab';
import ExposuresTab from './tabs/ExposuresTab';
import RisksTab from './tabs/RisksTab';
import DemographicsTab from './tabs/DemographicsTab';
import { TIER_COLORS } from '@/shared/chartColors';

const sample = loadFixture<Portfolio>('portfolio-sample.json');
const a = loadFixture<PortfolioAssessment>('assessment-portfolio.json');

const syncSsr = () => Object.assign(useStore.getInitialState(), useStore.getState());
const clean = (html: string) => html.replace(/<!-- -->/g, '');

const renderAt = (path: string) => {
  syncSsr();
  return clean(
    renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: '/portfolios/:portfolioId', element: createElement(PortfolioReportPage) })),
      ),
    ),
  );
};

beforeEach(() => {
  useStore.setState({ portfolios: [], draft: null, recommendations: {} });
});

describe('PortfolioReportPage', () => {
  it('says when the portfolio is unknown', () => {
    expect(renderAt('/portfolios/nope')).toContain('Portfolio not found');
  });
  it('renders the header and the assessing state', () => {
    useStore.getState().addPortfolio(sample);
    const html = renderAt(`/portfolios/${sample.id}`);
    expect(html).toContain(sample.name);
    expect(html).toContain(sample.lender);
    expect(html).toContain('Ask the farming agent');
    expect(html).toContain('Data as of');
    expect(html).toContain('Assessing 2 farms');
  });

  const selectedTab = (html: string) => [...html.matchAll(/id="report-tab-(\w+)"[^>]*aria-selected="true"/g)].map((m) => m[1]);

  it('shows the five tabs while assessing, Overview by default', () => {
    useStore.getState().addPortfolio(sample);
    const html = renderAt(`/portfolios/${sample.id}`);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Report sections"');
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    for (const t of ['Overview', 'Payments', 'Exposures', 'Risks', 'Demographics']) expect(html).toContain(`>${t}</button>`);
    expect(selectedTab(html)).toEqual(['overview']);
    expect(html).toContain('id="report-panel-overview"');
    expect(html).toContain('aria-labelledby="report-tab-overview"');
    expect(html).toContain('This section fills in when the assessment arrives.');
  });

  it('?tab= selects the tab; one tab stop; unknown values fall back to Overview', () => {
    useStore.getState().addPortfolio(sample);
    const risks = renderAt(`/portfolios/${sample.id}?tab=risks`);
    expect(selectedTab(risks)).toEqual(['risks']);
    expect(risks).toContain('id="report-panel-risks"');
    expect([...risks.matchAll(/role="tab"[^>]*tabindex="0"/g)]).toHaveLength(1);
    expect(selectedTab(renderAt(`/portfolios/${sample.id}?tab=Demographics&x=1`))).toEqual(['demographics']);
    expect(selectedTab(renderAt(`/portfolios/${sample.id}?tab=nope`))).toEqual(['overview']);
  });
});

describe('report tabs render with fixtures', () => {
  const html = (el: Parameters<typeof renderToString>[0]) => clean(renderToString(createElement(MemoryRouter, null, el)));

  it('Payments: installments chart with the 6/12 toggle, the 60-day list and credit actions', () => {
    const out = html(createElement(PaymentsTab, { portfolio: sample, assessment: a }));
    expect(out).toContain('Next installments');
    expect(out).toContain('aria-label="Months shown"');
    expect(out).toContain('6 months');
    expect(out).toContain('12 months');
    expect(out).toContain('Installments due in the next 60 days');
    // Ovalle's 30k on 2026-11-30, 23 days after the as-of.
    expect(out).toContain('Nov 30, 2026');
    expect(out).toContain('in 23 days');
    expect(out).toContain('$30,000');
    expect(out).toContain('Credit actions');
  });

  it('Exposures: tier, crop, zone and region; watch and high keep their own colours', () => {
    const out = html(createElement(ExposuresTab, { portfolio: sample, assessment: a }));
    for (const t of ['Exposure by tier', 'Exposure by crop', 'Exposure by zone', 'Exposure by region', 'Coquimbo', "O&#x27;Higgins"]) expect(out).toContain(t);
    expect(out).toContain(`background:${TIER_COLORS.watch.fg}`);
    expect(out).toContain('100.0%');
  });

  it('Risks: score distribution, water status (truthful while waiting and when done), drivers, disasters', () => {
    const waiting = html(createElement(RisksTab, { portfolio: sample, assessment: a, probes: new Map(), lookups: 'waiting' }));
    expect(waiting).toContain('Risk score distribution');
    expect(waiting).toContain('Water status');
    expect(waiting).toContain('once the portfolio assessment is current');
    expect(waiting).toContain('Recent disasters');
    const probes = new Map<string, FarmProbe | null>([
      ['cl-ovalle-table-grape', { water: 'stress', drivers: [{ peril: 'water', impact: 0.4 }] }],
      ['cl-requinoa-cherry', null],
    ]);
    const done = html(createElement(RisksTab, { portfolio: sample, assessment: a, probes, lookups: 'done' }));
    expect(done).toContain('2 of 2</span> farms checked');
    expect(done).toContain('could not be read');
    expect(done).toContain('Ovalle table grapes');
    expect(done).toContain('Stress drivers');
    expect(done).toContain('Water supply');
  });

  it('Demographics: crops with area, stage, region, zone, records and the map slot', () => {
    const out = html(createElement(DemographicsTab, { portfolio: sample, assessment: a, hoverFarmId: null, onHoverFarm: () => {}, onOpenFarm: () => {} }));
    for (const t of ['Farms by crop', 'Median area', 'Growth stage now', 'Bloom', 'Farms by region', 'Farms by zone', 'Farm records', 'Planting year', 'aria-label="Farms map by tier"']) expect(out).toContain(t);
    expect(out).toContain('5.8 ha');
  });
});

describe('ReportTable', () => {
  const rows = reportRows(a);
  const render = (sort: SortState = { key: 'score', dir: 'desc' }) =>
    clean(
      renderToString(
        createElement(
          MemoryRouter,
          null,
          createElement(ReportTable, {
            portfolioId: sample.id,
            rows: sortRows(rows, sort),
            totals: reportTotals(rows),
            currency: a.currency,
            asOf: a.asOf,
            sort,
            onSort: () => {},
            onOpen: () => {},
          }),
        ),
      ),
    );

  it('is a real table with the letter row and a TOTAL footer', () => {
    const html = render();
    expect(html).toMatch(/<table[^>]*>/);
    expect(html).toContain('<thead>');
    expect(html).toContain('<tfoot>');
    for (const l of ['(a)', '(b)', '(c)', '(d)', '(e)=(c)×(d)']) expect(html).toContain(l);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('Total');
    expect(html).toContain('100.0%');
    expect(html).toContain('$240,000');
    // Σ(e) = 36.00
    expect(html).toContain('36.00');
  });

  it('marks the sorted column and links each farm', () => {
    const html = render();
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain(`href="/portfolios/${sample.id}/farms/cl-ovalle-table-grape"`);
    // weighted risk per row: 50 % × 58.6 = 29.30
    expect(html).toContain('29.30');
    expect(html.indexOf('cl-ovalle-table-grape')).toBeLessThan(html.indexOf('cl-requinoa-cherry'));
    const asc = render({ key: 'score', dir: 'asc' });
    expect(asc).toContain('aria-sort="ascending"');
    expect(asc.indexOf('cl-requinoa-cherry')).toBeLessThan(asc.indexOf('cl-ovalle-table-grape'));
  });
});
