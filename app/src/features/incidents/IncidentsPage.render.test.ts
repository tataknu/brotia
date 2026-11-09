/** Server render of the Incidents page and its sidebar item (node). Effects do not run in SSR, so every portfolio is still assessing. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { IncidentsPage } from './IncidentsPage';

const sample = loadFixture<Portfolio>('portfolio-sample.json');

/** App mounted under /app/* as in main.tsx. */
const AppAtRoot = () => createElement(Routes, null, createElement(Route, { path: '/app/*', element: createElement(App) }));

const render = (el: Parameters<typeof createElement>[0], path = '/incidents') => {
  // zustand v5 hands React its INITIAL state as the server snapshot; copy the live state in (test-only).
  Object.assign(useStore.getInitialState(), useStore.getState());
  return renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(el))).replace(/<!-- -->/g, '');
};

beforeEach(() => {
  useStore.setState({ portfolios: [], draft: null, recommendations: {} });
});

describe('IncidentsPage', () => {
  it('offers a way in when there are no portfolios', () => {
    const html = render(IncidentsPage);
    expect(html).toContain('Incidents');
    expect(html).toContain('No portfolios yet');
    expect(html).toContain('href="/app/portfolios/new"');
  });

  it('shows the filters and a loading state while assessments run', () => {
    useStore.setState({ portfolios: [sample, { ...sample, id: 'copy', name: 'Second book' }] });
    const html = render(IncidentsPage);
    expect(html).toContain('Assessing 2 of 2');
    for (const label of ['24 h', '7 days', '30 days', 'Credit rules', 'Events', 'All portfolios (2)', 'Second book']) expect(html).toContain(label);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>24 h/);
    expect(html).not.toContain('No incidents in');
  });

  it('reads the window from the URL', () => {
    useStore.setState({ portfolios: [sample] });
    expect(render(IncidentsPage, '/incidents?window=7d')).toMatch(/aria-checked="true"[^>]*>7 days/);
  });

  it('is routed at /app/incidents with a sidebar item under Home', () => {
    const html = render(AppAtRoot, '/app/incidents');
    expect(html).toContain('href="/app/incidents"');
    expect(html.indexOf('>Home<')).toBeLessThan(html.indexOf('>Incidents<'));
    expect(html.indexOf('>Incidents<')).toBeLessThan(html.indexOf('>Portfolios<'));
    // No assessment yet → no badge.
    expect(html).not.toContain('data-testid="incidents-badge"');
  });
});
