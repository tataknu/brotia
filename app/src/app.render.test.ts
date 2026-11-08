/**
 * Smoke test: the shell, its navigation and every route render without throwing (server render, node).
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';
import { routeContext } from './shell/routeContext';
import { brotiaMarkSvg, markCells } from './shared/brand';
import { useStore } from './state/store';
import { loadFixture } from './shared/testing/fixtures';
import type { Portfolio } from './domain/types';

// zustand v5 hands React its INITIAL state object as the server snapshot; copy the live state into it (test-only).
const syncSsr = () => Object.assign(useStore.getInitialState(), useStore.getState());
const render = (path: string) => {
  syncSsr();
  return renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)));
};

describe('app shell', () => {
  it('renders the BrotIA sidebar on home', () => {
    const html = render('/');
    expect(html).toContain('BrotIA');
    expect(html).not.toContain('Climate Loan Monitor');
    for (const label of ['Home', 'Portfolios', 'New portfolio', 'Farming agent']) expect(html).toContain(label);
  });
  it('renders the portfolios list at /portfolios', () => {
    expect(render('/portfolios')).toContain('Restore sample portfolios');
  });
  it('lists stored portfolios as sidebar sub-items linking to their report', () => {
    const sample = loadFixture<Portfolio>('portfolio-sample.json');
    useStore.setState({ portfolios: [{ ...sample, id: 'pf-test', name: 'Test book' }] });
    const html = render('/portfolios');
    expect(html).toContain('href="/portfolios/pf-test"');
    expect(html).toContain('Test book');
    useStore.setState({ portfolios: [] });
  });
  it('renders portfolio, farm and wizard routes and the agent slot', () => {
    useStore.setState({ agentPanel: { open: true, portfolioId: 'x', zoneId: null, farmId: null } });
    expect(render('/portfolios/x')).toContain('Farming agent');
    expect(render('/portfolios/x/farms/y')).toContain('Farm');
    expect(render('/portfolios/new')).toContain('New portfolio');
    useStore.setState({ agentPanel: { open: false, portfolioId: null, zoneId: null, farmId: null } });
  });
  it('reads the route context for the agent', () => {
    expect(routeContext('/portfolios/a/farms/b')).toEqual({ portfolioId: 'a', farmId: 'b' });
    expect(routeContext('/portfolios/a')).toEqual({ portfolioId: 'a', farmId: null });
    expect(routeContext('/portfolios/new')).toEqual({ portfolioId: null, farmId: null });
    expect(routeContext('/')).toEqual({ portfolioId: null, farmId: null });
  });
});

describe('BrotIA mark', () => {
  it('draws the 7×7 grid with the risk ramp as the soil row', () => {
    const cells = markCells();
    expect(cells).toHaveLength(49);
    expect(cells.filter((c) => c.kind === 'soil').map((c) => c.fill)).toEqual(['#1F6B43', '#2FA05A', '#8CC63F', '#E3C93B', '#E8933A', '#D0533A', '#9E2F3A']);
    expect(cells.filter((c) => c.kind === 'stem')).toHaveLength(4);
    // Animation order: soil, then stem, then leaves.
    const last = (k: string) => Math.max(...cells.filter((c) => c.kind === k).map((c) => c.delay));
    const first = (k: string) => Math.min(...cells.filter((c) => c.kind === k).map((c) => c.delay));
    expect(first('stem')).toBeGreaterThan(last('soil'));
    expect(first('leaf-b')).toBeGreaterThan(last('stem'));
    expect(brotiaMarkSvg()).toMatch(/^<svg[^>]+viewBox="0 0 60 60">/);
  });
});
