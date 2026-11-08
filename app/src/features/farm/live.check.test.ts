/**
 * Optional check of REAL service responses against the farm page code (skipped unless the env vars are set):
 *
 *   CLM_FARM_ASSESSMENT_JSON=/path/assess.json CLM_FARM_IMAGERY_JSON=/path/imagery.json \
 *   CLM_PORTFOLIO_JSON=/path/sample.json npx vitest run src/features/farm/live.check.test.ts
 *
 * The JSON files are saved responses of POST /assess/farm, POST /imagery/farm and GET /portfolios/sample.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { FarmAssessment, ImageryTimeline, Portfolio } from '@/domain/types';
import { FarmAssessmentSchema, ImageryTimelineSchema, PortfolioSchema } from '@/domain/schemas';
import { chartWindow, driverNormal, layoutStageBands, monthlyTotals, repaymentPlan, thresholdBands, toTimeRows, waterRungs } from './farmData';
import { chooseDisplay, defaultFrameIndex, frameCounts } from './imageryModel';
import { FarmHeader } from './FarmHeader';
import { RiskCard } from './RiskCard';
import { PeersCard, WaterLadderCard } from './WaterPeersCards';
import { SeriesSection } from './FarmCharts';
import { Viewer } from './ImageryViewer';

const A = process.env.CLM_FARM_ASSESSMENT_JSON;
const I = process.env.CLM_FARM_IMAGERY_JSON;
const P = process.env.CLM_PORTFOLIO_JSON;
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as unknown;
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(createElement(MemoryRouter, null, el));

describe.skipIf(!A || !P)('live farm assessment', () => {
  it('parses and renders every card', () => {
    const portfolio = PortfolioSchema.parse(read(P!)) as Portfolio;
    const a = FarmAssessmentSchema.parse(read(A!)) as FarmAssessment;
    const farm = portfolio.farms.find((f) => f.id === a.farmId)!;
    expect(farm).toBeTruthy();
    const win = chartWindow(a);
    expect(win.start <= win.asOf).toBe(true);
    expect(layoutStageBands(a.stageBands, win.start, win.asOf, win.asOf).some((b) => b.current)).toBe(true);
    for (const s of Object.values(a.series)) toTimeRows(s.points);
    monthlyTotals(a.series.precip.points);
    expect(waterRungs(a.water)).toHaveLength(5);
    html(createElement(FarmHeader, { portfolio, farm, assessment: a, source: 'live', snapshotDate: null, loading: false, onAskFarm: () => {}, onAskZone: () => {} }));
    html(createElement(RiskCard, { risk: a.risk }));
    html(createElement(WaterLadderCard, { water: a.water, supplyAsOf: a.dataAsOf.water_supply }));
    html(createElement(PeersCard, { peers: a.peers }));
    html(
      createElement(SeriesSection, {
        assessment: a,
        win,
        thresholds: thresholdBands(a.stageBands, portfolio, farm, null),
        installments: repaymentPlan(farm.loan),
        currency: portfolio.currency,
        fallbackFrost: driverNormal(a, 'tmin_7d_min'),
        fallbackHeat: driverNormal(a, 'tmax_7d_max'),
      }),
    );
  });
});

describe.skipIf(!I || !P)('live imagery timeline', () => {
  it('parses, picks a default frame and renders the viewer', () => {
    const portfolio = PortfolioSchema.parse(read(P!)) as Portfolio;
    const t = ImageryTimelineSchema.parse(read(I!)) as ImageryTimeline;
    const farm = portfolio.farms.find((f) => f.id === t.farmId)!;
    const c = frameCounts(t.frames);
    expect(c.observed + c.interpolated).toBe(t.frames.length);
    if (t.frames.length) {
      const f = t.frames[defaultFrameIndex(t.frames)];
      expect(chooseDisplay(f, 'ndvi', false, t).path).toBeTruthy();
      const out = html(createElement(Viewer, { timeline: t, source: 'live', farm, bands: [] }));
      expect(out).toContain(t.trustNote);
    }
  });
});
