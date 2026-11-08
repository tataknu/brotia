/**
 * Pure helpers for the portfolios list (no React). Unit-tested in node.
 * Loan amounts shown here are the lender's own inputs (contract data), not computed metrics.
 */
import { COUNTRIES_FALLBACK, CROP_META } from '@/domain/constants';
import { outstandingAt } from '@/domain/schedule';
import type { Country, Crop, Currency, DataTier, Portfolio } from '@/domain/types';
import { CROPS } from '@/domain/types';

/** Regional-indicator flag for an ISO 3166-1 alpha-2 code; '' for anything else (e.g. GLOBAL). */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => base + c.charCodeAt(0) - 65));
}

export interface CountryInfo {
  code: string;
  name: string;
  flag: string;
  dataTier: DataTier;
}

/** Country name, flag and data tier, from /countries when loaded, else the static fallback. */
export function countryInfo(code: string, countries?: readonly Country[] | null): CountryInfo {
  const c = (countries ?? COUNTRIES_FALLBACK).find((x) => x.code === code) ?? COUNTRIES_FALLBACK.find((x) => x.code === code);
  return { code, name: c?.name ?? code, flag: flagEmoji(code), dataTier: c?.dataTier ?? (code === 'CL' ? 'enhanced' : 'standard') };
}

export interface PortfolioSummary {
  farms: number;
  /** Crops present, in CROPS order. */
  crops: Crop[];
  areaHa: number;
  loans: number;
  /** Sum of loan principal (lender input). */
  principal: number;
  /** Sum of outstandingAt(loan, asOf) (CONTRACT §E.8, same formula as the service). */
  outstanding: number;
  currency: Currency;
  rulesEdited: number;
}

export function summarise(p: Portfolio, asOf: string): PortfolioSummary {
  const present = new Set(p.farms.map((f) => f.crop));
  const loans = p.farms.filter((f) => f.loan);
  return {
    farms: p.farms.length,
    crops: CROPS.filter((c) => present.has(c)),
    areaHa: p.farms.reduce((s, f) => s + (f.areaHa || 0), 0),
    loans: loans.length,
    principal: loans.reduce((s, f) => s + (f.loan?.amount ?? 0), 0),
    outstanding: loans.reduce((s, f) => s + outstandingAt(f.loan!, asOf), 0),
    currency: p.currency,
    rulesEdited: p.audit.filter((c) => c.status === 'applied').length,
  };
}

/** Newest first; the sample portfolio is not special-cased. */
export function sortPortfolios(list: readonly Portfolio[]): Portfolio[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

export const cropName = (c: Crop) => CROP_META[c]?.label ?? c;
