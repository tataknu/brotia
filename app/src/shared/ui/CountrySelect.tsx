/**
 * Portfolio country picker: South American countries from GET /countries (Chile default), with the data
 * tier shown; GLOBAL is listed but disabled ("coming later"). Falls back to the static list until the
 * service or snapshot answers.
 */
import { useMemo } from 'react';
import { COUNTRIES_FALLBACK, DEFAULT_COUNTRY } from '@/domain/constants';
import type { Country } from '@/domain/types';
import { useCountries } from '@/data/hooks';
import { Select } from './Select';

export function countryOptions(countries: readonly Country[]) {
  const sorted = [...countries].sort((a, b) => (a.comingLater === b.comingLater ? a.name.localeCompare(b.name) : a.comingLater ? 1 : -1));
  return sorted.map((c) => ({
    value: c.code,
    label: c.comingLater ? `${c.name} (coming later)` : `${c.name}${c.dataTier === 'enhanced' ? ' · enhanced data' : ' · standard data'}`,
    disabled: c.comingLater,
  }));
}

export function CountrySelect({
  value,
  onChange,
  id,
  className,
}: {
  value: string | null | undefined;
  onChange: (code: string, country: Country) => void;
  id?: string;
  className?: string;
}) {
  const { data } = useCountries();
  const countries = data ?? COUNTRIES_FALLBACK;
  const options = useMemo(() => countryOptions(countries), [countries]);
  return (
    <Select
      id={id}
      className={className}
      value={value || DEFAULT_COUNTRY}
      options={options}
      onChange={(e) => {
        const c = countries.find((x) => x.code === e.target.value);
        if (c && !c.comingLater) onChange(c.code, c);
      }}
    />
  );
}
