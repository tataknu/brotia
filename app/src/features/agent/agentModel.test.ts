import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import { syncZones } from '@/domain/rules';
import type { AgentRecommendation, CropTemplate, Portfolio, PortfolioAssessment } from '@/domain/types';
import { ApiRequestError, NetworkError, UnavailableError } from '@/data/http';
import {
  SUGGESTED_PROMPTS,
  promptsFor,
  agentErrorInfo,
  bestRowIndex,
  contextForPrompt,
  contextLabel,
  describeChange,
  evidenceTable,
  formatValue,
  normaliseContext,
  scopeLabel,
  targetExists,
} from './agentModel';

const portfolio = syncZones(loadFixture<Portfolio>('portfolio-sample.json'));
const templates = loadFixture<CropTemplate[]>('crops.json');
const rec = loadFixture<AgentRecommendation>('agent-recommendation.json');
const assessment = loadFixture<PortfolioAssessment>('assessment-portfolio.json');

describe('prompts and context', () => {
  it('has the two demo prompts first, in English', () => {
    expect(SUGGESTED_PROMPTS[0]).toEqual({ kind: 'zone', text: 'Suggest frost and harvest-rain settings for this zone, with a backtest.' });
    expect(SUGGESTED_PROMPTS[1]).toEqual({ kind: 'farm', text: 'Why is this farm at watch?' });
  });
  it('shows the farm chip only in farm context, worded for its tier (RT-7)', () => {
    expect(promptsFor({ zoneId: 'z', farmId: null }, null).map((p) => p.kind)).toEqual(['zone', 'portfolio']);
    expect(promptsFor({ zoneId: null, farmId: 'f' }, 'high')[1].text).toBe('Why is this farm at high stress?');
    expect(promptsFor({ zoneId: null, farmId: 'f' }, 'normal')[1].text).toMatch(/normal/);
  });
  it('keeps exactly one of zoneId / farmId', () => {
    expect(normaliseContext({ zoneId: 'z', farmId: 'f' })).toEqual({ zoneId: null, farmId: 'f' });
    expect(normaliseContext({ zoneId: 'z', farmId: null })).toEqual({ zoneId: 'z', farmId: null });
  });
  it('picks the stressed farm for the farm prompt and its zone for the zone prompt', () => {
    const none = { zoneId: null, farmId: null };
    expect(contextForPrompt(portfolio, none, 'farm', assessment.ranked)).toEqual({ zoneId: null, farmId: 'cl-ovalle-table-grape' });
    expect(contextForPrompt(portfolio, none, 'zone', assessment.ranked)).toEqual({ zoneId: 'auto-cl-ovalle-table-grape', farmId: null });
    // A farm in context: its own zone.
    expect(contextForPrompt(portfolio, { zoneId: null, farmId: 'cl-requinoa-cherry' }, 'zone')).toEqual({ zoneId: 'auto-cl-requinoa-cherry', farmId: null });
    // A zone in context stays.
    expect(contextForPrompt(portfolio, { zoneId: 'auto-cl-requinoa-cherry', farmId: null }, 'zone', assessment.ranked).zoneId).toBe('auto-cl-requinoa-cherry');
    expect(contextForPrompt(portfolio, { zoneId: 'x', farmId: 'y' }, 'portfolio')).toEqual({ zoneId: null, farmId: null });
    // No assessment: first farm.
    expect(contextForPrompt(portfolio, none, 'farm', null).farmId).toBe(portfolio.farms[0].id);
  });
  it('labels the context', () => {
    expect(contextLabel(portfolio, { zoneId: null, farmId: 'cl-requinoa-cherry' })).toBe('Farm: Requínoa cherries');
    expect(contextLabel(portfolio, { zoneId: null, farmId: null })).toBe('Whole portfolio');
    expect(contextLabel(portfolio, { zoneId: 'auto-cl-requinoa-cherry', farmId: null })).toMatch(/^Zone: /);
  });
});

describe('proposal diff cards', () => {
  it('describes zone threshold paths with crop and stage labels', () => {
    const d = describeChange(rec.proposals[0], portfolio, templates);
    expect(d.crop).toBe('cherry');
    expect(d.label).toMatch(/^Cherry · .+ · Frost damage starts at$/);
    expect(d.unit).toBe('°C');
    expect(formatValue(rec.proposals[0].oldValue, d)).toBe('−2.4 °C');
    expect(formatValue(rec.proposals[0].newValue, d)).toBe('−2.0 °C');
    const h = describeChange(rec.proposals[1], portfolio, templates);
    expect(h.label).toContain('Damaging rain in 72 h');
    expect(formatValue(15, h)).toBe('15 mm');
  });
  it('describes other scopes', () => {
    expect(describeChange({ scope: { level: 'farm', id: 'cl-requinoa-cherry' }, path: 'overrides.weights.c' }, portfolio, templates).label).toBe('Cherry · Weight c (geography)');
    expect(describeChange({ scope: { level: 'crop', id: 'cherry' }, path: 'stages.bloom.sensitivity.frost' }, portfolio, templates).label).toMatch(/Sensitivity to frost$/);
    expect(describeChange({ scope: { level: 'farm', id: 'cl-requinoa-cherry' }, path: 'creditRuleOverrides.cr-abandonment.enabled' }, portfolio).label).toContain('cr-abandonment');
    expect(formatValue(null, { unit: '', digits: 0 })).toBe('Inherited');
    expect(formatValue('field_visit', { unit: '', digits: 0 })).toBe('Field visit');
    expect(formatValue(true, { unit: '', digits: 0 })).toBe('Yes');
  });
  it('labels scopes and checks targets', () => {
    expect(scopeLabel({ level: 'crop', id: 'table_grape' }, portfolio)).toBe('All table grape farms');
    expect(scopeLabel({ level: 'farm', id: 'cl-ovalle-table-grape' }, portfolio)).toBe('Farm · Ovalle table grapes');
    expect(targetExists(rec.proposals[0].scope, portfolio)).toBe(true);
    expect(targetExists({ level: 'zone', id: 'nope' }, portfolio)).toBe(false);
    expect(targetExists({ level: 'farm', id: 'x' }, undefined)).toBe(false);
  });
});

describe('evidence', () => {
  it('turns the backtest into a table and highlights the best row', () => {
    const t = evidenceTable(rec.evidence[0].data)!;
    expect(t.param).toBe('rules.stages.bloom.frostCriticalC');
    expect(t.seasons).toBe(13);
    expect(t.columns.map((c) => c.key)).toEqual(['value', 'hits', 'falseAlarms', 'missed']);
    expect(t.columns.map((c) => c.label)).toEqual(['Value', 'Hits', 'False alarms', 'Missed']);
    expect(t.rows).toHaveLength(2);
    expect(bestRowIndex(t)).toBe(1);
  });
  it('returns null for non-tabular data', () => {
    expect(evidenceTable(rec.evidence[1].data)).toBeNull();
    expect(evidenceTable(null)).toBeNull();
    expect(evidenceTable({ candidates: [] })).toBeNull();
    expect(evidenceTable([{ year: 2013, hit: true }])?.columns.map((c) => c.label)).toEqual(['Year', 'Hit']);
  });
});

describe('errors', () => {
  it('maps 503 no_api_key to a setup message that names the env var', () => {
    const i = agentErrorInfo(new ApiRequestError(503, 'no_api_key', 'ANTHROPIC_API_KEY is not set'));
    expect(i.kind).toBe('no_api_key');
    expect(i.message).toContain('ANTHROPIC_API_KEY');
  });
  it('maps offline, timeouts and other errors', () => {
    expect(agentErrorInfo(new UnavailableError('x')).kind).toBe('offline');
    expect(agentErrorInfo(new NetworkError('t', true)).kind).toBe('timeout');
    expect(agentErrorInfo(new NetworkError('down')).kind).toBe('offline');
    expect(agentErrorInfo(new ApiRequestError(404, 'not_found', 'zone z')).kind).toBe('invalid');
    expect(agentErrorInfo(new Error('boom')).message).toBe('boom');
  });
});
