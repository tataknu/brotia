import { describe, expect, it } from 'vitest';
import type { Provenance } from '@/domain/types';
import { frameConfidence, frameKindLabel, provenanceFlags, provenanceRows, srLabel } from './labels';

const prov: Provenance = {
  source: 'cr2met_nrt',
  sourceLabel: 'CR2MET NRT (CR2, Univ. de Chile)',
  observedAt: '2026-11-06',
  fetchedAt: '2026-11-07T15:40:00Z',
  resolution: '0.05° (~5 km)',
  licenceTier: 'commercial_ok',
  dataTier: 'enhanced',
  stale: false,
  estimated: false,
  note: null,
};

describe('provenance labels', () => {
  it('a clean value has no flags', () => {
    expect(provenanceFlags(prov)).toEqual([]);
  });
  it('flags stale, estimated, demo-only and unavailable honestly', () => {
    const f = provenanceFlags({ ...prov, observedAt: null, stale: true, estimated: true, licenceTier: 'demo_only', note: 'CR2MET down' });
    expect(f.map((x) => x.label)).toEqual(['Unavailable', 'Stale', 'Estimated', 'Demo only']);
    expect(f[0].hint).toBe('CR2MET down');
  });
  it('a lender declaration without an observation date is not flagged unavailable', () => {
    expect(provenanceFlags({ ...prov, source: 'lender', sourceLabel: 'Declared by the lender', observedAt: null })).toEqual([]);
  });
  it('rows cover every provenance field', () => {
    const rows = provenanceRows(prov);
    expect(rows.map((r) => r.label)).toEqual(['Source', 'Observed', 'Fetched', 'Resolution', 'Licence', 'Data tier', 'Stale', 'Estimated']);
    expect(rows[1].value).toBe('Nov 6, 2026');
    expect(rows[2].value).toBe('Nov 7, 2026, 15:40 UTC');
  });
});

describe('frame labels (CONTRACT §E.12)', () => {
  it('observed and interpolated', () => {
    expect(frameKindLabel({ kind: 'observed', daysToClear: 0 })).toBe('Observed');
    expect(frameKindLabel({ kind: 'interpolated', daysToClear: 5 })).toBe('Interpolated (5 days from a clear image)');
    expect(frameKindLabel({ kind: 'interpolated', daysToClear: 1 })).toBe('Interpolated (1 day from a clear image)');
  });
  it('super-resolution kinds', () => {
    expect(srLabel('ai')).toBe('AI-enhanced');
    expect(srLabel('resampled')).toBe('Resampled, not AI');
    expect(srLabel(null)).toBeNull();
  });
  it('confidence decays with distance to a clear image', () => {
    expect(frameConfidence(0)).toBe('high');
    expect(frameConfidence(10)).toBe('medium');
    expect(frameConfidence(20)).toBe('low');
  });
});
