/**
 * Smoke test: the shell, its navigation and every route render without throwing (server render, node).
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';
import { routeContext } from './shell/routeContext';
import { appPath, paths } from './shell/paths';
import { brotiaMarkSvg, markCells } from './shared/brand';
import { useStore } from './state/store';
import { loadFixture } from './shared/testing/fixtures';
import type { Portfolio } from './domain/types';

// App is mounted under /app/* as in main.tsx.
// zustand v5 hands React its INITIAL state object as the server snapshot; copy the live state into it (test-only).
const syncSsr = () => Object.assign(useStore.getInitialState(), useStore.getState());
const render = (path: string) => {
  syncSsr();
  return renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '/app/*', element: createElement(App) }))));
};

describe('app shell', () => {
  it('renders the BrotIA sidebar on home', () => {
    const html = render('/app');
    expect(html).toContain('BrotIA');
    expect(html).not.toContain('Climate Loan Monitor');
    for (const label of ['Home', 'Portfolios', 'New portfolio', 'Farming agent']) expect(html).toContain(label);
  });
  it('renders the portfolios list at /app/portfolios', () => {
    expect(render('/app/portfolios')).toContain('Restore sample portfolios');
  });
  it('lists stored portfolios as sidebar sub-items linking to their report', () => {
    const sample = loadFixture<Portfolio>('portfolio-sample.json');
    useStore.setState({ portfolios: [{ ...sample, id: 'pf-test', name: 'Test book' }] });
    const html = render('/app/portfolios');
    expect(html).toContain('href="/app/portfolios/pf-test"');
    expect(html).toContain('Test book');
    useStore.setState({ portfolios: [] });
  });
  it('renders portfolio, farm and wizard routes and the agent slot', () => {
    useStore.setState({ agentPanel: { open: true, portfolioId: 'x', zoneId: null, farmId: null } });
    expect(render('/app/portfolios/x')).toContain('Farming agent');
    expect(render('/app/portfolios/x/farms/y')).toContain('Farm');
    expect(render('/app/portfolios/new')).toContain('New portfolio');
    useStore.setState({ agentPanel: { open: false, portfolioId: null, zoneId: null, farmId: null } });
  });
  it('marks the active portfolio in the sidebar under /app', () => {
    const sample = loadFixture<Portfolio>('portfolio-sample.json');
    useStore.setState({ portfolios: [{ ...sample, id: 'pf-test', name: 'Test book' }] });
    expect(render('/app/portfolios/pf-test')).toMatch(/<a[^>]*(aria-current="page"[^>]*href="\/app\/portfolios\/pf-test"|href="\/app\/portfolios\/pf-test"[^>]*aria-current="page")/);
    useStore.setState({ portfolios: [] });
  });
  it('builds /app URLs with the path helper', () => {
    expect(appPath()).toBe('/app');
    expect(appPath('/portfolios/x')).toBe('/app/portfolios/x');
    expect(paths.farm('p', 'f')).toBe('/app/portfolios/p/farms/f');
    expect(paths.home).toBe('/app');
  });
  it('reads the route context for the agent', () => {
    expect(routeContext('/app/portfolios/a/farms/b')).toEqual({ portfolioId: 'a', farmId: 'b' });
    expect(routeContext('/app/portfolios/a')).toEqual({ portfolioId: 'a', farmId: null });
    expect(routeContext('/app/portfolios/new')).toEqual({ portfolioId: null, farmId: null });
    expect(routeContext('/app')).toEqual({ portfolioId: null, farmId: null });
    expect(routeContext('/')).toEqual({ portfolioId: null, farmId: null });
    // Old root URLs are redirects, not app routes
    expect(routeContext('/portfolios/a')).toEqual({ portfolioId: null, farmId: null });
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
