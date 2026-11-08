/** Server render of the agent panel + the proposal → audit flow through the store (node, no DOM). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import { proposalState, getAtPath } from '@/domain/rules';
import type { AgentRecommendation, CropTemplate, Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { AgentPanel } from './AgentPanel';

const sample = loadFixture<Portfolio>('portfolio-sample.json');
const rec = loadFixture<AgentRecommendation>('agent-recommendation.json');
const templates = loadFixture<CropTemplate[]>('crops.json');

const render = () => (syncSsr(), renderToString(createElement(MemoryRouter, null, createElement(AgentPanel))).replace(/<!-- -->/g, ''));

// zustand v5 hands React its INITIAL state object as the server snapshot; copy the live state into it so
// server renders see what these tests set (test-only).
const syncSsr = () => Object.assign(useStore.getInitialState(), useStore.getState());

beforeEach(() => {
  useStore.setState({ portfolios: [], recommendations: {}, agentPanel: { open: true, portfolioId: null, zoneId: null, farmId: null } });
  useStore.getState().addPortfolio(sample);
});

describe('AgentPanel', () => {
  it('asks to open a portfolio when there is no context', () => {
    expect(render()).toContain('Open a portfolio');
  });

  it('shows the suggested prompts and the context picker', () => {
    useStore.getState().openAgent({ portfolioId: sample.id, zoneId: null, farmId: null });
    const html = render();
    expect(html).toContain('Suggest frost and harvest-rain settings for this zone, with a backtest.');
    expect(html).toContain('Which farms need a field visit before their next installment?');
    expect(html).not.toContain('Why is this farm at');
    expect(html).toContain('Whole portfolio');
    expect(html).toContain('Farm · Requínoa cherries');
  });

  it('renders the answer, backtest table, tool trace and diff cards', () => {
    useStore.getState().openAgent({ portfolioId: sample.id, zoneId: rec.zoneId ?? null, farmId: null });
    useStore.getState().addRecommendation(sample.id, rec);
    const html = render();
    expect(html).toContain('<strong');
    expect(html).toContain('False alarms');
    expect(html).toContain('Tool calls (4)');
    expect(html).toContain('backtest');
    expect(html).toContain('Frost damage starts at');
    expect(html).toContain('−2.4 °C');
    expect(html).toContain('−2.0 °C');
    expect(html).toContain('overrides.cherry.rules.stages.bloom.frostCriticalC');
    expect(html).toContain('Apply');
    expect(html).toContain('Dismiss');
  });

  it('applies and dismisses proposals through the audit (agent proposed, user applied)', () => {
    const s = useStore.getState();
    s.addRecommendation(sample.id, rec);
    const before = useStore.getState().portfolios[0].audit.length;
    s.applyProposal(sample.id, rec.id, rec.proposals[0].id, templates);
    s.dismissProposal(sample.id, rec.id, rec.proposals[1].id, templates);
    const p = useStore.getState().portfolios[0];
    expect(p.audit.length).toBe(before + 2);
    const applied = p.audit[p.audit.length - 2];
    expect(applied).toMatchObject({ status: 'applied', actor: { kind: 'user' }, recommendationId: rec.id, path: rec.proposals[0].path, newValue: -2.0 });
    expect(p.audit[p.audit.length - 1]).toMatchObject({ status: 'dismissed', recommendationId: rec.id });
    const zone = p.zones.find((z) => z.id === rec.proposals[0].scope.id)!;
    expect(getAtPath(zone, rec.proposals[0].path)).toBe(-2.0);
    expect(getAtPath(zone, rec.proposals[1].path)).not.toBe(15);
    expect(proposalState(p, rec, rec.proposals[0])).toBe('applied');
    expect(proposalState(p, rec, rec.proposals[1])).toBe('dismissed');

    useStore.getState().openAgent({ portfolioId: sample.id, zoneId: null, farmId: null });
    const html = render();
    expect(html).toContain('Applied');
    expect(html).toContain('Dismissed');
    expect(html).toContain('Proposed by Farming agent');
    expect(html).toContain('Undo');
  });
});
