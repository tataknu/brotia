/** Server render of Home (node). Effects (fetches) do not run in SSR, so every portfolio is still assessing. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { HomePage } from './HomePage';

const sample = loadFixture<Portfolio>('portfolio-sample.json');

const render = () => {
  // zustand v5 hands React its INITIAL state as the server snapshot; copy the live state in (test-only).
  Object.assign(useStore.getInitialState(), useStore.getState());
  return renderToString(createElement(MemoryRouter, null, createElement(HomePage))).replace(/<!-- -->/g, '');
};

beforeEach(() => {
  useStore.setState({ portfolios: [], draft: null, recommendations: {} });
});

describe('HomePage', () => {
  it('shows the headline and a way in when there are no portfolios', () => {
    const html = render();
    expect(html).toContain('Portfolio overview');
    expect(html).not.toContain('Multiple allocation performance');
    expect(html).toContain('No portfolios yet');
    expect(html).toContain('href="/portfolios/new"');
  });

  it('never blanks while assessments load: payments and outstanding from the loan schedules, tiers pending', () => {
    useStore.setState({ portfolios: [sample, { ...sample, id: 'copy', name: 'Second book' }] });
    const html = render();
    expect(html).toContain('Assessing 2 of 2');
    expect(html).not.toContain('Risk as of');
    // KPI strip: the two payment tiles first, then the book.
    const order = ['Due in next 90 days', 'Due at watch or high', 'Total outstanding', 'Credit actions open', 'Incidents (last 24 h)'].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/Due in next 90 days<\/div><div[^>]*>\$[\d,]{4,}/);
    expect(html).not.toMatch(/Due at watch or high<\/div><div[^>]*>\$0</);
    expect(html).toContain('Tier pending');
    expect(html).toContain('Assessing…');
    // Hero, then risk per portfolio, then allocation (collapsed) and the table.
    const sections = ['Payment schedule', 'Installments in the next 60 days', 'Risk per portfolio', 'Allocation', 'id="pf-h"'].map((t) => html.indexOf(t));
    expect(sections.every((i) => i > 0)).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
    expect(html).toContain('aria-label="Months shown"');
    expect(html).toMatch(/<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('Second book');
    expect(html).toContain('Open report');
    expect(html).toContain(`href="/portfolios/${sample.id}"`);
  });

  it('separates currencies instead of adding them', () => {
    useStore.setState({ portfolios: [sample, { ...sample, id: 'clp', name: 'Peso book', currency: 'CLP' }] });
    const html = render();
    expect(html).toContain('Amounts are not converted between currencies');
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toContain('Peso book');
  });
});
