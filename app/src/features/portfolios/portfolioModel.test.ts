import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Country, Portfolio } from '@/domain/types';
import { countryInfo, flagEmoji, sortPortfolios, summarise } from './portfolioModel';

const portfolio = loadFixture<Portfolio>('portfolio-sample.json');
const countries = loadFixture<Country[]>('countries.json');

describe('portfolio cards', () => {
  it('builds flags from ISO codes only', () => {
    expect(flagEmoji('CL')).toBe('\u{1F1E8}\u{1F1F1}');
    expect(flagEmoji('GLOBAL')).toBe('');
    expect(flagEmoji(null)).toBe('');
  });
  it('resolves country name and data tier', () => {
    expect(countryInfo('CL', countries)).toMatchObject({ name: 'Chile', dataTier: 'enhanced' });
    expect(countryInfo('PE', null)).toMatchObject({ name: 'Peru', dataTier: 'standard' });
    expect(countryInfo('XX', countries)).toMatchObject({ name: 'XX', dataTier: 'standard' });
  });
  it('summarises farms, crops and the loan book (§E.8 outstanding)', () => {
    const s = summarise(portfolio, '2026-11-07');
    expect(s.farms).toBe(2);
    expect(s.crops).toEqual(['cherry', 'table_grape']);
    expect(s.loans).toBe(2);
    expect(s.principal).toBe(300000);
    // Same as the service's totalExposure for the fixture on 2026-11-07.
    expect(s.outstanding).toBe(240000);
    expect(s.rulesEdited).toBe(portfolio.audit.filter((c) => c.status === 'applied').length);
  });
  it('sorts newest first', () => {
    const older = { ...portfolio, id: 'a', createdAt: '2020-01-01T00:00:00Z' };
    expect(sortPortfolios([older, portfolio]).map((p) => p.id)).toEqual([portfolio.id, 'a']);
  });
});
