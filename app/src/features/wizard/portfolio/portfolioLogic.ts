/** Pure helpers for the Portfolio step (node-tested). */
import type { Country, Currency } from '@/domain/types';

export interface CurrencyOption {
  value: Currency;
  label: string;
}

/**
 * Currencies offered for a country. The v1 contract has USD and CLP only: Chile gets CLP (local) and USD;
 * every other country gets USD (its local currency is not in the v1 contract).
 */
export function currencyOptions(country: Pick<Country, 'code' | 'defaultCurrency'> | undefined, current?: Currency): CurrencyOption[] {
  const out: CurrencyOption[] = [];
  const local = country?.defaultCurrency;
  const isChile = local === 'CLP' || country?.code === 'CL';
  if (isChile || current === 'CLP') out.push({ value: 'CLP', label: isChile ? 'CLP, Chilean peso (local)' : 'CLP, Chilean peso' });
  out.push({ value: 'USD', label: 'USD, US dollar' });
  return out;
}

/** Plain-language note about the data tier of a country. */
export function countryHint(country: Pick<Country, 'name' | 'dataTier' | 'comingLater'> | undefined): string {
  if (!country) return 'Where the orchards are. Chile has the enhanced data tier.';
  if (country.comingLater) return 'Coming later.';
  if (country.dataTier === 'enhanced')
    return `Enhanced data tier: ${country.name}'s national weather, water, orchard cadastre and emergency sources are used.`;
  return `Standard data tier: ${country.name} uses global sources only (ERA5, CHIRPS, Sentinel-2/Landsat, GWIS, GFM). Chile-only signals such as water decrees, snowmelt forecasts and orchard peers are not available.`;
}

/** Currency to use after a country change: keep it when still offered, else the country's default. */
export function currencyAfterCountryChange(current: Currency, country: Pick<Country, 'code' | 'defaultCurrency'>): Currency {
  const offered = currencyOptions(country).map((o) => o.value);
  if (offered.includes(current) && current === country.defaultCurrency) return current;
  return offered.includes(country.defaultCurrency) ? country.defaultCurrency : offered[0];
}
