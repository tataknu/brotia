/** Server-render smoke tests of the farm page parts with the contract fixtures (node, no DOM). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { CropTemplate, FarmAssessment, ImageryTimeline, Portfolio } from '@/domain/types';
import { FarmAssessmentSchema, ImageryTimelineSchema } from '@/domain/schemas';
import { loadFixture } from '@/shared/testing/fixtures';
import { FarmPage } from './FarmPage';
import { FarmHeader } from './FarmHeader';
import { OverviewTab } from './OverviewTab';
import { FarmTabs, useFarmTab } from './FarmTabBar';
import { parseTab, tabForKey } from './tabModel';
import { eventsForZone, zoneBBox } from './farmEvents';
import { farmAudit } from './RulesTab';
import { CROP_META } from '@/domain/constants';
import type { ClimateEvent, RuleChange } from '@/domain/types';
import { RiskCard } from './RiskCard';
import { PeersCard, WaterLadderCard } from './WaterPeersCards';
import { SeriesSection } from './FarmCharts';
import { Viewer } from './ImageryViewer';
import { chartWindow, driverNormal, repaymentPlan, thresholdBands } from './farmData';

const a = FarmAssessmentSchema.parse(loadFixture('assessment-farm-cl-ovalle-table-grape.json')) as FarmAssessment;
const timeline = ImageryTimelineSchema.parse(loadFixture('imagery-cl-ovalle-table-grape.json')) as ImageryTimeline;
const portfolio = loadFixture<Portfolio>('portfolio-sample.json');
const crops = loadFixture<CropTemplate[]>('crops.json');
const farm = portfolio.farms.find((f) => f.id === a.farmId)!;

/** Rendered HTML without React's text separators, so plain-text assertions work. */
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(createElement(MemoryRouter, null, el)).replace(/<!-- -->/g, '');

describe('farm page parts render with fixtures', () => {
  it('header: compact, money and risk first, live badge, back link to the report, agent buttons', () => {
    const out = html(createElement(FarmHeader, { portfolio, farm, assessment: a, source: 'live', snapshotDate: null, loading: false, onAskFarm: () => {}, onAskZone: () => {} }));
    expect(out).toContain(farm.name);
    expect(out).toContain(`${portfolio.name} report`);
    expect(out).not.toContain(CROP_META[farm.crop].labelEs); // moved to the Overview's "About this data"
    expect(out).toContain('$120,000');
    expect(out).toContain('$30,000');
    expect(out).toContain('58.6');
    expect(out).toContain('Watch');
    expect(out).toContain('Live');
    expect(out).toContain('Ask the agent about this farm');
  });
  it('overview: verdict, what to do, why, details and "About this data" (v1.3)', () => {
    const out = html(createElement(OverviewTab, { portfolio, farm, assessment: a, imagery: timeline, imagerySource: 'snapshot', onSelectTab: () => {} }));
    for (const s of ['Verdict', 'What to do', 'Why', 'Details', 'About this data', 'Next payment', '$30,000', 'Next installments', '$120,000', 'Bloom'])
      expect(out).toContain(s);
    expect(out).toMatch(/Decree No\. <span[^>]*>177<\/span> active/);
    expect(out).toContain(CROP_META[farm.crop].labelEs);
    // the technical headline is only in the collapsed disclosure, never the lead; the score is not repeated here
    expect(out.indexOf(a.risk.headline.slice(0, 30))).toBeGreaterThan(out.indexOf('About this data'));
    expect(out).not.toContain('Climate risk now');
    expect(out).not.toContain(`>${a.risk.score.toFixed(1)}<`);
  });
  it('header: offline snapshot label', () => {
    const out = html(createElement(FarmHeader, { portfolio, farm, assessment: a, source: 'snapshot', snapshotDate: '2026-11-07', loading: false, onAskFarm: () => {}, onAskZone: () => {} }));
    expect(out).toContain('Offline snapshot of Nov 7, 2026');
  });
  it('risk card: formula, components, drivers, credit action', () => {
    const out = html(createElement(RiskCard, { risk: a.risk }));
    expect(out).toContain(a.risk.formula.replace(/&/g, '&amp;').slice(0, 20));
    expect(out).toContain('Climate and water (C)');
    expect(out).toContain('Disasters (D)');
    expect(out).toContain('Geography (G)');
    expect(out).toContain('cr-decree-low-snowmelt');
    expect(out).toContain('Declared emergency');
  });
  it('water ladder and peers', () => {
    const w = html(createElement(WaterLadderCard, { water: a.water, supplyAsOf: a.dataAsOf.water_supply }));
    for (const q of ['Is it irrigated?', 'How much water does it need now?', 'Can the basin supply it?', 'Is it getting enough?', 'Has irrigation stopped?']) expect(w).toContain(q);
    expect(w).toContain('Scarcity decree active');
    const p = html(createElement(PeersCard, { peers: a.peers }));
    expect(p).toContain('In line with its peers');
    expect(p).toContain('7 same-crop CIREN orchards');
  });
  it('series section renders without throwing', () => {
    const win = chartWindow(a);
    const out = html(
      createElement(SeriesSection, {
        assessment: a,
        win,
        thresholds: thresholdBands(a.stageBands, portfolio, farm, crops),
        installments: repaymentPlan(farm.loan),
        currency: portfolio.currency,
        fallbackFrost: driverNormal(a, 'tmin_7d_min'),
        fallbackHeat: driverNormal(a, 'tmax_7d_max'),
      }),
    );
    expect(out).toContain('Vigour (NDVI)');
    expect(out).toContain('Frost damage starts at −1.1 °C');
    expect(out).toContain('Rain');
  });
  it('imagery viewer: frame label, trust statement, covered warning, AI toggle', () => {
    const out = html(createElement(Viewer, { timeline, source: 'live', farm, bands: a.stageBands }));
    expect(out).toContain('Observed');
    expect(out).toContain('Numbers use native 10 m data; AI images are for viewing.');
    expect(out).toContain(timeline.trustNote);
    expect(out).toContain('often under overhead plastic');
    expect(out).toContain('AI-enhanced 2.5 m');
    expect(out).toContain('Frame 3 of 3');
  });
  it('page: missing portfolio state', () => {
    // Server rendering reads zustand's initial state (no portfolios), so only the "not found" path is testable here.
    const out = renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: ['/portfolios/nope/farms/x'] },
        createElement(Routes, null, createElement(Route, { path: '/portfolios/:portfolioId/farms/:farmId', element: createElement(FarmPage) })),
      ),
    );
    expect(out).toContain('Portfolio not found');
  });
});

/** Renders the tab bar the way FarmPage wires it (state from the URL). */
function TabsAt(url: string) {
  function Harness() {
    const [tab, select] = useFarmTab();
    return createElement(FarmTabs, { tab, onSelect: select });
  }
  return renderToString(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Harness))).replace(/<!-- -->/g, '');
}
const selectedTab = (out: string) => [...out.matchAll(/id="farm-tab-(\w+)"[^>]*aria-selected="true"/g)].map((m) => m[1]);

describe('farm tabs', () => {
  it('?tab= selects the tab', () => {
    expect(selectedTab(TabsAt('/portfolios/p/farms/f?tab=water'))).toEqual(['water']);
    expect(selectedTab(TabsAt('/portfolios/p/farms/f?tab=rules&x=1'))).toEqual(['rules']);
  });
  it('missing or unknown ?tab= falls back to Overview', () => {
    expect(selectedTab(TabsAt('/portfolios/p/farms/f'))).toEqual(['overview']);
    expect(selectedTab(TabsAt('/portfolios/p/farms/f?tab=nope'))).toEqual(['overview']);
    expect(parseTab('RISK')).toBe('risk');
  });
  it('tabs follow the WAI-ARIA pattern: one tab stop, panels linked, arrow keys wrap', () => {
    const out = TabsAt('/x?tab=imagery');
    expect(out).toContain('role="tablist"');
    expect(out.match(/role="tab"/g)).toHaveLength(6);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('aria-controls="farm-panel-imagery"');
    expect(tabForKey('overview', 'ArrowLeft')).toBe('events');
    expect(tabForKey('events', 'ArrowRight')).toBe('overview');
    expect(tabForKey('water', 'Home')).toBe('overview');
    expect(tabForKey('water', 'End')).toBe('events');
    expect(tabForKey('water', 'a')).toBeNull();
  });
});

describe('farm tab helpers', () => {
  it('events: keeps events whose geometry overlaps the zone box or that list the farm', () => {
    const zone = { center: [-71.24, -30.58] as [number, number], radiusM: 3338 };
    const [w, s, e, n] = zoneBBox(zone);
    expect(w).toBeLessThan(-71.24);
    expect(n).toBeGreaterThan(-30.58);
    const base = { kind: 'fire', region: 'r', end: null, severity: 'moderate', source: 's', evidenceKind: 'observed_footprint', affectedFarmIds: [], affectedExposure: 0, provenance: {} } as unknown as ClimateEvent;
    const inside = { ...base, id: 'in', title: 'in', start: '2026-01-01', geometry: { type: 'Point', coordinates: [-71.24, -30.58] } } as ClimateEvent;
    const far = { ...base, id: 'far', title: 'far', start: '2026-02-01', geometry: { type: 'Point', coordinates: [-70.0, -33.0] } } as ClimateEvent;
    const listed = { ...base, id: 'listed', title: 'listed', start: '2026-03-01', geometry: null, affectedFarmIds: ['f1'] } as ClimateEvent;
    expect(eventsForZone([inside, far, listed], zone, 'f1').map((x) => x.id)).toEqual(['listed', 'in']);
    void s;
  });
  it('rules: the audit shows changes to this farm, its zone for its crop, its crop and portfolio credit rules', () => {
    const ch = (scope: RuleChange['scope'], path: string, id: string): RuleChange => ({ id, at: '2026-11-01T00:00:00Z', actor: { kind: 'user', name: 'u' }, scope, path, oldValue: 1, newValue: 2, reason: '', status: 'applied' });
    const zoneId = a.zoneId;
    const p = {
      ...portfolio,
      audit: [
        ch({ level: 'farm', id: farm.id }, 'overrides.weights.a', 'mine'),
        ch({ level: 'farm', id: 'other' }, 'overrides.weights.a', 'other-farm'),
        ch({ level: 'zone', id: zoneId }, `overrides.${farm.crop}.weights.a`, 'my-zone'),
        ch({ level: 'crop', id: farm.crop }, 'weights.a', 'my-crop'),
        ch({ level: 'crop', id: 'cherry' }, 'weights.a', 'other-crop'),
        ch({ level: 'portfolio', id: portfolio.id }, 'creditRules.x', 'credit'),
      ],
    };
    expect(farmAudit(p, farm).map((c) => c.id)).toEqual(['credit', 'my-crop', 'my-zone', 'mine']);
  });
});

