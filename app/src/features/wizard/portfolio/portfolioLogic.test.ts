import { describe, expect, it } from 'vitest';
import { COUNTRIES_FALLBACK } from '@/domain/constants';
import { countryHint, currencyAfterCountryChange, currencyOptions } from './portfolioLogic';

const cl = COUNTRIES_FALLBACK.find((c) => c.code === 'CL')!;
const pe = COUNTRIES_FALLBACK.find((c) => c.code === 'PE')!;
const global = COUNTRIES_FALLBACK.find((c) => c.code === 'GLOBAL')!;

describe('portfolio step logic', () => {
  it('offers CLP (local) and USD in Chile, USD elsewhere', () => {
    expect(currencyOptions(cl).map((o) => o.value)).toEqual(['CLP', 'USD']);
    expect(currencyOptions(pe).map((o) => o.value)).toEqual(['USD']);
    // A CLP portfolio moved to another country keeps CLP selectable (loans are never relabelled silently).
    expect(currencyOptions(pe, 'CLP').map((o) => o.value)).toEqual(['CLP', 'USD']);
  });
  it('switches to the country default currency', () => {
    expect(currencyAfterCountryChange('USD', cl)).toBe('CLP');
    expect(currencyAfterCountryChange('CLP', cl)).toBe('CLP');
    expect(currencyAfterCountryChange('CLP', pe)).toBe('USD');
  });
  it('explains the data tier', () => {
    expect(countryHint(cl)).toMatch(/Enhanced data tier/);
    expect(countryHint(pe)).toMatch(/Standard data tier: Peru uses global sources only/);
    expect(countryHint(global)).toBe('Coming later.');
  });
});
