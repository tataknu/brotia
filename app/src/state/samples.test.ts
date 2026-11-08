import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Portfolio, SamplePortfolioSummary } from '@/domain/types';

const base = loadFixture<Portfolio>('portfolio-sample.json');
const CL: Portfolio = { ...base, id: 'sample-cl', name: 'Chile Specialty Fruit Credit I', code: 'CLSF1', lender: 'Banco Valle Andino' };
const SUR: Portfolio = { ...base, id: 'sample-cl-sur', name: 'Southern Orchards Credit II', code: 'CLSO2', lender: 'Cooperativa Agrícola del Sur' };
const summary = (p: Portfolio): SamplePortfolioSummary => ({ id: p.id, name: p.name, code: p.code, lender: p.lender, country: 'CL', currency: 'USD', farmCount: p.farms.length, crops: [] });

vi.mock('@/data/api', () => ({
  listSamplePortfolios: vi.fn(async () => ({ data: [summary(CL), summary(SUR)], source: 'live' })),
  getSamplePortfolio: vi.fn(async (id: string) => ({ data: id === 'sample-cl' ? CL : SUR, source: 'live' })),
}));

const { useStore } = await import('./store');
const { bootstrapSamples, loadMissingSamples, resetSampleBootstrap } = await import('./samples');

beforeEach(() => {
  resetSampleBootstrap();
  useStore.setState({ portfolios: [], draft: null, recommendations: {}, samplesSeeded: false });
});

describe('sample bootstrap (ADR-0026 D6)', () => {
  it('loads both samples on a first start with an empty store, once', async () => {
    await bootstrapSamples();
    expect(useStore.getState().portfolios.map((p) => p.id)).toEqual(['sample-cl', 'sample-cl-sur']);
    expect(useStore.getState().samplesSeeded).toBe(true);
  });
  it('does not bring deleted samples back on a later start', async () => {
    useStore.setState({ samplesSeeded: true });
    await bootstrapSamples();
    expect(useStore.getState().portfolios).toEqual([]);
  });
  it('refreshes only name, code and lender of an old stored copy; rules and audit stay', async () => {
    const audit = [{ id: 'ch1' }] as unknown as Portfolio['audit'];
    const old: Portfolio = { ...CL, name: 'Banco Demo — huertos Chile', code: undefined, lender: 'Banco Demo', audit, creditRules: [] };
    useStore.setState({ portfolios: [old] });
    await bootstrapSamples();
    const p = useStore.getState().portfolios;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ name: 'Chile Specialty Fruit Credit I', code: 'CLSF1', lender: 'Banco Valle Andino', creditRules: [] });
    expect(p[0].audit).toBe(audit);
    expect(p[0].farms).toBe(old.farms);
  });
  it('restore adds missing samples and keeps stored ones', async () => {
    const edited = { ...CL, creditRules: [] };
    useStore.setState({ portfolios: [edited] });
    expect(await loadMissingSamples()).toBe(1);
    expect(useStore.getState().portfolios[0]).toBe(edited);
  });
});
