/** Insurance request as an email draft (ADR-0025): subject, body, figure choice, attachments, and the rendered dialog. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Driver, FarmAssessment, InsuranceRequest, Portfolio, PortfolioAssessment, SeriesPoint } from '@/domain/types';
import { buildVerdict } from '@/features/farm/overviewModel';
import { farmRegion, reportRows } from '../reportModel';
import { InsuranceHeader } from './InsuranceCell';
import { InsuranceRequestModal } from './InsuranceRequestModal';
import { EmailBodyView, Envelope } from './EmailParts';
import {
  MIN_BAND_POINTS,
  attachments,
  coverSentence,
  emailBody,
  farmVerdict,
  loanSentence,
  monthRange,
  pickFigure,
  placeName,
  sourceShort,
  subjectLine,
  type FigureInput,
} from './emailModel';
import { COPY, buildPayload, topDrivers } from './insuranceModel';

// The dialog portals to <body>; on the server render it in place.
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), createPortal: (n: unknown) => n }));

const sample = loadFixture<Portfolio>('portfolio-sample.json');
const pa = loadFixture<PortfolioAssessment>('assessment-portfolio.json');
const fa = loadFixture<FarmAssessment>('assessment-farm-cl-ovalle-table-grape.json');
const rows = reportRows(pa);
const ovalleRow = rows.find((r) => r.farmId === 'cl-ovalle-table-grape')!;
const ovalle = sample.farms.find((f) => f.id === 'cl-ovalle-table-grape')!;

const payload = (over: Partial<Parameters<typeof buildPayload>[0]> = {}) =>
  buildPayload({ portfolio: sample, farm: ovalle, row: ovalleRow, asOf: pa.asOf, drivers: topDrivers(fa.risk.drivers), perils: ['water'], note: '', ...over });

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(createElement(MemoryRouter, null, el)).replace(/<!-- -->/g, '');

/* synthetic assessment slices for the figure choice */
const pts = (n: number, over: Partial<SeriesPoint> = {}): SeriesPoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, value: 0.3, p10: 0.2, p50: 0.3, p90: 0.4, ...over }));
const prov = { source: 's2', sourceLabel: 'Sentinel-2 L2A (Copernicus, via Planetary Computer)', observedAt: '2026-10-29', fetchedAt: '', resolution: '10 m', licenceTier: 'commercial_ok', dataTier: 'enhanced', stale: false, estimated: false } as const;
const drv = (peril: Driver['peril'], impact: number, component: Driver['component'] = 'climate', normal: Driver['normal'] = null) =>
  ({ peril, impact, component, metric: `${peril}_m`, normal }) as unknown as Driver;
const input = (drivers: Driver[], series: Partial<Record<'ndvi' | 'ndmi' | 'tmin' | 'tmax' | 'precip', number>>, snowmelt: number | null = null): FigureInput =>
  ({
    asOf: '2026-11-08',
    risk: {
      drivers,
      components: { climate: { key: 'climate', value: 0.7, drivers: [] }, disaster: { key: 'disaster', value: 0.2, drivers: [] }, geography: { key: 'geography', value: 0.4, drivers: [] } },
    },
    series: Object.fromEntries(Object.entries(series).map(([k, n]) => [k, { variable: k, unit: k === 'tmin' || k === 'tmax' ? '°C' : k === 'precip' ? 'mm' : 'index', points: pts(n!), provenance: prov }])),
    water: { supply: { snowmeltPctOfNormal: snowmelt, basin: 'Limarí', provenance: { ...prov, sourceLabel: 'DGA snowmelt forecast', observedAt: '2026-10-01' } } },
  }) as unknown as FigureInput;

describe('insurance email: envelope and body', () => {
  it('the subject names the farm, area, region and the perils asked', () => {
    const place = placeName(farmRegion(ovalle), 'Chile');
    expect(place).toBe('Coquimbo region');
    expect(subjectLine(payload({ perils: ['frost', 'water'] }), place)).toBe('Cover request: Ovalle table grapes, 5.8 ha, Coquimbo region · Frost, Drought / water supply');
    expect(subjectLine(payload({ perils: [] }), 'Chile')).toBe('Cover request: Ovalle table grapes, 5.8 ha, Chile');
    expect(placeName(null, 'Chile')).toBe('Chile');
  });
  it('the body reuses the farm Overview verdict word for word', () => {
    const v = farmVerdict(fa, 'table_grape');
    expect(v).toEqual(buildVerdict(fa, 'table_grape'));
    const b = emailBody(payload(), 'Coquimbo region', { verdict: v, next: fa.nextInstallment });
    expect(b.verdict).toBe(v!.text);
    expect(b.farm).toMatch(/^Ovalle table grapes \(5\.8 ha, Coquimbo region\) is (rated high stress|on watch|rated normal), \d+ of 100, as of /);
    expect(emailBody(payload(), 'Chile', { verdict: null, next: null }).verdict).toBeNull();
  });
  it('the loan sentence: amount, outstanding, next payment, maturity; or no loan', () => {
    const loan = { currency: 'USD' as const, amount: 180000, outstanding: 120000, maturityDate: '2028-05-31' };
    expect(loanSentence(loan, '2026-11-08', { dueDate: '2026-11-30', amount: 30000 })).toBe(
      'Our loan is $180,000: $120,000 is outstanding on Nov 8, 2026, the next payment of $30,000 is due Nov 30, 2026 and it matures May 31, 2028.',
    );
    expect(loanSentence(loan, '2026-11-08', null)).toBe('Our loan is $180,000: $120,000 is outstanding on Nov 8, 2026 and it matures May 31, 2028.');
    expect(loanSentence(null, '2026-11-08', null)).toBe('The farm has no loan with us.');
  });
  it('the cover sentence asks for the perils and names what no parametric peril addresses', () => {
    expect(coverSentence(['water', 'fire'], ['abandonment'])).toBe(
      'We ask for a quote on parametric cover for drought / water supply and fire. Abandonment also drives the risk here; none of the parametric perils addresses it.',
    );
    expect(coverSentence(['frost'], [])).toBe('We ask for a quote on parametric cover for frost.');
    expect(coverSentence([], [])).toBe('Choose the perils to ask cover for.');
  });
  it('none of the composed copy claims more than a queue (ADR-0025 D4)', () => {
    const p = payload({ perils: ['water', 'fire'] });
    const b = emailBody(p, 'Coquimbo region', { verdict: null, next: fa.nextInstallment });
    const all = [subjectLine(p, 'Coquimbo region'), b.farm, b.loan, b.cover, coverSentence(['water'], ['abandonment', 'vigour'])].join(' ');
    for (const w of ['sent to Suyana', 'received', 'insured', 'covered', 'approved']) expect(all.toLowerCase()).not.toContain(w.toLowerCase());
  });
});

describe('insurance email: the figure follows the leading driver', () => {
  it('abandonment or vigour → NDVI with its usual band, captioned like a figure', () => {
    const f = pickFigure(input([drv('abandonment', 1), drv('water', 0.4)], { ndvi: 80, ndmi: 80 }))!;
    expect(f.kind).toBe('band');
    expect(f.kind === 'band' && f.variable).toBe('ndvi');
    expect(f.caption).toBe('Fig. 1 · Canopy greenness (NDVI) vs its usual range, Jan 2026 – Mar 2026. Sentinel-2 L2A, 10 m.');
    expect(pickFigure(input([drv('vigour', 0.5)], { ndvi: 80 }))!.kind).toBe('band');
  });
  it('water or a decree → NDMI; with too few NDMI values, the snowmelt forecast vs normal', () => {
    const f = pickFigure(input([drv('water', 0.46), drv('abandonment', 0.4)], { ndvi: 80, ndmi: 80 }))!;
    expect(f.kind === 'band' && f.variable).toBe('ndmi');
    const s = pickFigure(input([drv('declared_emergency', 0.6, 'disaster')], { ndmi: MIN_BAND_POINTS - 1 }, 64))!;
    expect(s.kind).toBe('snowmelt');
    expect(s.kind === 'snowmelt' && s.pct).toBe(64);
    expect(s.caption).toContain('Limarí basin');
  });
  it('frost now → daily lows with the damage level; frost only in the site history → components', () => {
    const f = pickFigure(input([drv('frost', 0.7, 'climate', -2.4)], { tmin: 60 }))!;
    expect(f.kind).toBe('daily');
    expect(f.kind === 'daily' && f.threshold).toBe(-2.4);
    expect(pickFigure(input([drv('frost', 0.3, 'geography')], { tmin: 60 }))!.kind).toBe('components');
  });
  it('anything else, or a series too short to draw (no padding) → the C, D, G components', () => {
    const c = pickFigure(input([drv('fire', 0.6, 'disaster')], {}))!;
    expect(c.kind).toBe('components');
    expect(c.kind === 'components' && c.parts.map((p) => `${p.letter}=${p.value}`)).toEqual(['C=0.7', 'D=0.2', 'G=0.4']);
    expect(pickFigure(input([drv('abandonment', 1)], { ndvi: 3 }))!.kind).toBe('components');
    expect(pickFigure(null)).toBeNull();
  });
  it('the contract fixture (3 points per series, a DGA decree leading) falls back to the snowmelt bar', () => {
    expect(pickFigure(fa)!.kind).toBe('snowmelt');
  });
  it('source and month range helpers', () => {
    expect(sourceShort(prov)).toBe('Sentinel-2 L2A, 10 m');
    expect(sourceShort({ sourceLabel: 'BrotIA', resolution: 'n/a' })).toBe('BrotIA');
    expect(monthRange([{ date: '2025-10-09', value: 1, p10: null, p50: null, p90: null }, { date: '2026-11-08', value: null, p10: null, p50: null, p90: null }])).toBe('Oct 2025');
  });
});

describe('insurance email: attachments are the payload, nothing else', () => {
  it('names only what the queued payload carries', () => {
    const p = payload();
    const a = attachments(p);
    expect(a.map((x) => x.name)).toEqual(['farm.json', 'loan.json', 'risk-assessment.json', 'request.json']);
    expect(a[0].data).toBe(p.farm);
    expect(a[2].data).toBe(p.risk);
    expect(a[3].data).toBe(p);
    expect(attachments(payload({ farm: { ...ovalle, loan: null } })).map((x) => x.name)).not.toContain('loan.json');
    // no outline or series in the payload, so no such attachment (ADR-0025 sends the centroid, not the polygon)
    expect(a.some((x) => /geojson|csv/.test(x.name))).toBe(false);
  });
});

describe('insurance email: rendered', () => {
  it('the envelope: Suyana logo at about 36 px, From the lender via BrotIA, the subject', () => {
    const out = html(createElement(Envelope, { lender: 'Banco Valle Andino', portfolioName: 'Sample', subject: 'Cover request: X' }));
    expect(out).toMatch(/<img[^>]*src="\/partners\/suyana\.svg"[^>]*width="36"[^>]*height="36"/);
    expect(out).toContain('parametric climate insurance');
    expect(out).toContain('Banco Valle Andino');
    expect(out).toContain('via BrotIA');
    expect(out).toContain('Cover request: X');
  });
  it('the body: sentences, the figure with its caption, toggle chips, key facts, P.S. and attachments', () => {
    const p = payload({ perils: ['water'] });
    const figure = pickFigure(input([drv('abandonment', 1)], { ndvi: 80 }));
    const body = emailBody(p, 'Coquimbo region', { verdict: farmVerdict(fa, 'table_grape'), next: fa.nextInstallment });
    const out = html(
      createElement(EmailBodyView, { p, body, place: 'Coquimbo region', figure, suggested: ['water'], onToggle: () => {}, note: '', onNote: () => {}, signer: p.lender }),
    );
    expect(out).toContain('Hello Suyana team,');
    expect(out).toContain(body.loan.replace(/'/g, '&#x27;'));
    expect(out).toMatch(/<figure[\s\S]*<svg[\s\S]*<figcaption[\s\S]*Fig\. 1 · Canopy greenness/);
    expect(out).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Drought \/ water supply/);
    expect((out.match(/aria-pressed="false"/g) ?? []).length).toBe(3);
    expect(out).toContain('Suggested from the farm&#x27;s leading drivers');
    expect(out).toContain('Key facts');
    expect(out).toContain('P.S.');
    expect(out).toContain('request.json');
    expect(out).toContain('Technical detail');
  });
  it('the column header logo is about 22 px', () => {
    expect(html(createElement(InsuranceHeader))).toMatch(/<img[^>]*width="22"[^>]*height="22"/);
  });
});

describe('insurance dialog: honest copy and states', () => {
  // createPortal is rendered in place (mock above); the dialog only reads document.body as the portal target.
  beforeAll(() => vi.stubGlobal('document', { body: null }));
  afterAll(() => vi.unstubAllGlobals());
  const props = { portfolio: sample, row: ovalleRow, asOf: pa.asOf, countryName: 'Chile', onClose: () => {}, onQueued: () => {} };
  it('compose: the envelope is pinned with the subject, the footer carries the honest line and Send', () => {
    const out = html(createElement(InsuranceRequestModal, props));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('Cover request: Ovalle table grapes, 5.8 ha, Coquimbo region');
    expect(out).toContain(COPY.beforeSend.replace(/'/g, '&#x27;'));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Send to Suyana/); // waits for the farm's drivers
    expect(out).not.toContain('not yet sent to Suyana');
  });
  it('queued: "Request queued · ID … · not yet sent to Suyana" and no Send button', () => {
    const existing: InsuranceRequest = {
      id: 'ins-0123456789ab',
      createdAt: '2026-11-07T15:00:00Z',
      portfolioId: sample.id,
      farmId: ovalle.id,
      status: 'queued',
      payload: payload({ perils: ['water'], note: 'quote before bloom' }),
    };
    const out = html(createElement(InsuranceRequestModal, { ...props, existing }));
    expect(out).toContain(COPY.queued('ins-0123456789ab'));
    expect(out).toContain('Queued');
    expect(out).toContain('quote before bloom');
    expect(out).not.toContain('Send to Suyana');
  });
});
