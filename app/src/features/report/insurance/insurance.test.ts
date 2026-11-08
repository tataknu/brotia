/** Insurance column (v1.1, ADR-0025): pure model, contract schemas, api client and server-rendered states. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import { ApiRequestError, SERVICE_URL, UnavailableError, createInsuranceRequest, listInsuranceRequests } from '@/data/api';
import { __resetConnection } from '@/data/connection';
import { InsuranceRequestListSchema, InsuranceRequestPayloadSchema, InsuranceRequestSchema } from '@/domain/schemas';
import { INSURANCE_PERILS } from '@/domain/types';
import type { Driver, InsuranceRequest, Portfolio, PortfolioAssessment } from '@/domain/types';
import { ReportTable } from '../ReportTable';
import { reportRows, reportTotals } from '../reportModel';
import { InsuranceCell, InsuranceHeader } from './InsuranceCell';
import {
  COPY,
  OWN_ZONE,
  buildPayload,
  defaultPerils,
  latLng,
  latestByFarm,
  mergeRequests,
  togglePeril,
  topDrivers,
  uncoveredPerils,
  zoneName,
} from './insuranceModel';

const sample = loadFixture<Portfolio>('portfolio-sample.json');
const a = loadFixture<PortfolioAssessment>('assessment-portfolio.json');
const rows = reportRows(a);
const ovalleRow = rows.find((r) => r.farmId === 'cl-ovalle-table-grape')!;
const ovalle = sample.farms.find((f) => f.id === 'cl-ovalle-table-grape')!;

const d = (peril: Driver['peril'], impact: number, text = `${peril} text`) => ({
  peril,
  impact,
  text,
  metric: `${peril}_metric`,
});

const payload = () =>
  buildPayload({
    portfolio: sample,
    farm: ovalle,
    row: ovalleRow,
    asOf: a.asOf,
    drivers: topDrivers([d('water', 0.6), d('abandonment', 0.4), d('frost', 0.2), d('fire', 0.1)]),
    perils: ['water', 'frost'],
    note: '  quote before bloom  ',
  });

const request = (over: Partial<InsuranceRequest> = {}): InsuranceRequest => ({
  id: 'ins-0123456789ab',
  createdAt: '2026-11-07T15:00:00Z',
  portfolioId: sample.id,
  farmId: 'cl-ovalle-table-grape',
  status: 'queued',
  payload: payload(),
  ...over,
});

describe('insurance model', () => {
  it('top drivers: first 3 with impact > 0', () => {
    expect(topDrivers([d('water', 0.6), d('frost', 0), d('fire', 0.3), d('heat', 0.2), d('flood', 0.1)]).map((x) => x.peril)).toEqual([
      'water',
      'fire',
      'heat',
    ]);
  });
  it('default perils come from the top drivers, in the contract order; others are listed as uncovered', () => {
    const top = [d('abandonment', 0.6), d('fire', 0.5), d('water', 0.4)];
    expect(defaultPerils(top)).toEqual(['water', 'fire']);
    expect(uncoveredPerils(top)).toEqual(['abandonment']);
    expect(defaultPerils([d('vigour', 0.5)])).toEqual([]);
    expect(uncoveredPerils([d('vigour', 0.5), d('vigour', 0.3), d('heat', 0.2)])).toEqual(['vigour', 'heat']);
  });
  it('a DGA decree (declared emergency, decree_active) suggests drought / water supply; other emergencies stay uncovered', () => {
    const decree = {
      peril: 'declared_emergency' as const,
      impact: 0.5,
      text: 'DGA decree No. 177',
      metric: 'decree_active',
    };
    expect(defaultPerils(topDrivers([d('abandonment', 0.9), decree]))).toEqual(['water']);
    expect(uncoveredPerils(topDrivers([d('abandonment', 0.9), decree]))).toEqual(['abandonment']);
    expect(uncoveredPerils([{ peril: 'declared_emergency', metric: 'other' }])).toEqual(['declared_emergency']);
  });
  it('toggling keeps the contract order', () => {
    expect(togglePeril(['fire'], 'frost')).toEqual(['frost', 'fire']);
    expect(togglePeril(['frost', 'fire'], 'frost')).toEqual(['fire']);
    expect(INSURANCE_PERILS).toEqual(['frost', 'water', 'harvest_rain', 'fire']);
  });
  it('builds the payload from the portfolio, the assessment and the farm, unchanged', () => {
    const p = payload();
    expect(p.partner).toBe('suyana');
    expect(p.lender).toBe(sample.lender);
    expect(p.portfolioName).toBe(sample.name);
    expect(p.farm).toMatchObject({
      name: ovalle.name,
      crop: 'table_grape',
      areaHa: ovalle.areaHa,
      centroid: ovalle.centroid,
      country: 'CL',
      zoneId: ovalleRow.zoneId,
    });
    expect(p.loan).toEqual({
      currency: ovalle.loan!.currency,
      amount: ovalle.loan!.amount,
      outstanding: ovalleRow.outstanding,
      maturityDate: ovalle.loan!.maturityDate,
    });
    expect(p.risk).toMatchObject({
      asOf: a.asOf,
      score: ovalleRow.score,
      tier: ovalleRow.tier,
    });
    expect(p.risk.drivers).toEqual([
      { peril: 'water', text: 'water text' },
      { peril: 'abandonment', text: 'abandonment text' },
      { peril: 'frost', text: 'frost text' },
    ]);
    expect(p.perils).toEqual(['water', 'frost']);
    expect(p.uncoveredPerils).toEqual(['abandonment']);
    expect(p.note).toBe('quote before bloom');
    expect(InsuranceRequestPayloadSchema.safeParse(p).success).toBe(true);
  });
  it('a farm without a loan sends loan null; an empty note is null', () => {
    const p = buildPayload({
      portfolio: sample,
      farm: { ...ovalle, loan: null },
      row: ovalleRow,
      asOf: a.asOf,
      drivers: [],
      perils: ['frost'],
      note: '   ',
    });
    expect(p.loan).toBeNull();
    expect(p.note).toBeNull();
    expect(p.risk.drivers).toEqual([]);
  });
  it('zone names: shared zones by name, own zones described', () => {
    expect(zoneName('z1', [{ id: 'z1', name: 'Requínoa', auto: false }])).toBe('Requínoa');
    expect(zoneName('auto-x', [{ id: 'auto-x', name: 'auto', auto: true }])).toBe(OWN_ZONE);
    expect(zoneName('missing', [])).toBe(OWN_ZONE);
  });
  it('latest request per farm wins; session requests merge without duplicates', () => {
    const old = request({
      id: 'ins-000000000001',
      createdAt: '2026-11-06T10:00:00Z',
    });
    const now = request({
      id: 'ins-000000000002',
      createdAt: '2026-11-07T10:00:00Z',
    });
    const other = request({
      id: 'ins-000000000003',
      farmId: 'cl-requinoa-cherry',
    });
    const m = latestByFarm([old, now, other]);
    expect(m.get('cl-ovalle-table-grape')!.id).toBe(now.id);
    expect(m.get('cl-requinoa-cherry')!.id).toBe(other.id);
    expect(mergeRequests([old, now], [now, other]).map((r) => r.id)).toEqual([now.id, other.id, old.id]);
    expect(mergeRequests(undefined, [other])).toHaveLength(1);
  });
  it('shows centroids as lat, lng', () => {
    expect(latLng([-71.2, -30.6])).toBe('-30.60000, -71.20000');
  });
  it('the honest copy is exact', () => {
    expect(COPY.beforeSend).toBe("BrotIA will queue this request for Suyana. Suyana's integration is not live yet; your team forwards it.");
    expect(COPY.queued('ins-abc')).toBe('Request queued · ID ins-abc · not yet sent to Suyana.');
  });
  it('request and list responses parse with the contract schemas', () => {
    expect(InsuranceRequestSchema.safeParse(request()).success).toBe(true);
    expect(InsuranceRequestListSchema.safeParse([request()]).success).toBe(true);
    expect(InsuranceRequestSchema.safeParse({ ...request(), status: 'approved' }).success).toBe(false);
  });
});

describe('insurance api client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const calls: { url: string; method: string; body: unknown }[] = [];
  const serve = (up: boolean, insurance: 'ok' | 'missing') =>
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/snapshot/')) return json(loadFixture('manifest.json'));
      if (!up) throw new TypeError('fetch failed');
      const path = url.slice(SERVICE_URL.length).split('?')[0];
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path === '/health') return json(loadFixture('health.json'));
      if (insurance === 'missing') return json({ error: 'not_found', detail: 'Not Found' }, 404);
      if (path === '/insurance/requests') return init?.method === 'POST' ? json(request()) : json([request()]);
      return json({ error: 'not_found', detail: path }, 404);
    });

  beforeEach(() => {
    __resetConnection();
    calls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POST queues the request and validates the answer', async () => {
    vi.stubGlobal('fetch', serve(true, 'ok'));
    const body = {
      portfolioId: sample.id,
      farmId: 'cl-ovalle-table-grape',
      payload: payload(),
    };
    const res = await createInsuranceRequest(body);
    expect(res.source).toBe('live');
    expect(res.data.status).toBe('queued');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`${SERVICE_URL}/insurance/requests`);
    expect(post.body).toEqual(body);
  });
  it('GET lists by portfolioId', async () => {
    vi.stubGlobal('fetch', serve(true, 'ok'));
    const res = await listInsuranceRequests(sample.id);
    expect(res.data).toHaveLength(1);
    expect(calls.some((c) => c.url === `${SERVICE_URL}/insurance/requests?portfolioId=${sample.id}`)).toBe(true);
  });
  it('a service without the outbox answers 404 as ApiRequestError', async () => {
    vi.stubGlobal('fetch', serve(true, 'missing'));
    await expect(listInsuranceRequests(sample.id)).rejects.toBeInstanceOf(ApiRequestError);
  });
  it('offline: both calls need the live service, nothing is faked', async () => {
    vi.stubGlobal('fetch', serve(false, 'ok'));
    await expect(listInsuranceRequests(sample.id)).rejects.toThrow(UnavailableError);
    await expect(
      createInsuranceRequest({
        portfolioId: sample.id,
        farmId: 'x',
        payload: payload(),
      }),
    ).rejects.toThrow('Needs the live service');
  });
});

describe('insurance column renders', () => {
  const html = (el: Parameters<typeof renderToString>[0]) => renderToString(createElement(MemoryRouter, null, el)).replace(/<!-- -->/g, '');
  const cell = (props: Partial<Parameters<typeof InsuranceCell>[0]>) =>
    html(
      createElement(InsuranceCell, {
        farmName: 'Ovalle',
        request: undefined,
        availability: 'live',
        onRequest: () => {},
        onView: () => {},
        ...props,
      }),
    );

  it('the header carries the Suyana logo and the word Insurance', () => {
    const out = html(createElement(InsuranceHeader));
    expect(out).toContain('src="/partners/suyana.svg"');
    expect(out).toContain('Insurance');
    expect(out).toContain('(Suyana)');
  });
  it('a farm without a request gets the Request button', () => {
    const out = cell({});
    expect(out).toContain('>Request</button>');
    expect(out).not.toMatch(/<button[^>]*disabled=/);
  });
  it('a requested farm shows "Requested · <date>" and the Queued chip, never "sent"', () => {
    const out = cell({ request: request() });
    expect(out).toContain('Requested · <span class="font-mono tabular-nums">Nov 7</span>');
    expect(out).toContain('Queued');
    expect(out).toContain('not yet sent to Suyana');
  });
  it('offline the button is disabled with "Needs the live service"', () => {
    const out = cell({ availability: 'offline' });
    expect(out).toMatch(/<button[^>]*disabled=""/);
    expect(out).toContain('Needs the live service');
  });
  it('the table adds the column last, with a TOTAL cell, only when given', () => {
    const base = {
      portfolioId: sample.id,
      rows,
      totals: reportTotals(rows),
      currency: a.currency,
      asOf: a.asOf,
      sort: { key: 'rank', dir: 'asc' } as const,
      onSort: () => {},
      onOpen: () => {},
    };
    const without = html(createElement(ReportTable, base));
    expect(without).not.toContain('suyana.svg');
    const withCol = html(
      createElement(ReportTable, {
        ...base,
        insurance: {
          header: createElement(InsuranceHeader),
          render: (r) => createElement('span', null, `ins:${r.farmId}`),
          total: '1 queued',
        },
      }),
    );
    const heads = [...withCol.matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1]);
    expect(heads).toHaveLength(9);
    expect(heads[7]).toContain('Credit action');
    expect(heads[8]).toContain('suyana.svg');
    expect(withCol).toContain('ins:cl-ovalle-table-grape');
    expect(withCol).toContain('1 queued');
  });
});
