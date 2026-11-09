/** Server render of the portfolios list (/portfolios, node). Effects (fetches) do not run in SSR. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { PortfoliosPage } from './PortfoliosPage';

const sample = loadFixture<Portfolio>('portfolio-sample.json');

// zustand v5 hands React its INITIAL state object as the server snapshot; copy the live state into it (test-only).
const syncSsr = () => Object.assign(useStore.getInitialState(), useStore.getState());

const render = () => {
  syncSsr();
  return renderToString(
    createElement(MemoryRouter, { initialEntries: ['/portfolios'] }, createElement(Routes, null, createElement(Route, { path: '/portfolios', element: createElement(PortfoliosPage) }))),
  ).replace(/<!-- -->/g, '');
};

beforeEach(() => {
  useStore.setState({ portfolios: [], draft: null, recommendations: {} });
});

describe('PortfoliosPage', () => {
  it('offers the wizard when empty, a quiet restore link and no "load sample" UI (ADR-0026 D6)', () => {
    const html = render();
    expect(html).toContain('Restore sample portfolios');
    expect(html).not.toContain('Load sample');
    expect(html).not.toContain('aria-label="Sample portfolios"');
    expect(html).toContain('New portfolio');
    expect(html).toContain('No portfolios yet');
  });
  it('lists stored portfolios in a table with country, data tier, crops and a link to the report', () => {
    useStore.getState().addPortfolio(sample);
    const html = render();
    expect(html).toContain('<table');
    expect(html).toContain(sample.name);
    expect(html).toContain('Chile');
    expect(html).toContain('Enhanced data');
    expect(html).toContain('Table grape');
    expect(html).toContain('Restore sample portfolios');
    expect(html).toContain(`href="/app/portfolios/${sample.id}"`);
    expect(html).not.toContain('>Total<'); // one portfolio: no total row
  });
  it('shows the portfolio code in mono before the name', () => {
    useStore.getState().addPortfolio({ ...sample, code: 'CLSF1', name: 'Chile Specialty Fruit Credit I' });
    expect(render()).toMatch(/<span class="font-mono">CLSF1<\/span><span aria-hidden="true"> · <\/span>Chile Specialty Fruit Credit I/);
  });
  it('adds a total row when every portfolio uses the same currency', () => {
    useStore.getState().addPortfolio(sample);
    useStore.getState().addPortfolio({ ...sample, id: 'copy', name: 'Copy book' });
    expect(render()).toContain('>Total<');
  });
});
