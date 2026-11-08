import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { AgentRecommendation } from '@/domain/types';
import { inlineText, parseInline, parseMarkdown } from './mdParse';

describe('parseInline', () => {
  it('parses bold, italic, code and safe links', () => {
    const n = parseInline('**−2.0 °C** and _note_ with `code` and [doc](https://example.org)');
    expect(n.map((x) => x.t)).toEqual(['strong', 'text', 'em', 'text', 'code', 'text', 'link']);
    expect(inlineText(n)).toBe('−2.0 °C and note with code and doc');
  });
  it('keeps unsafe links and unmatched markers as text', () => {
    expect(parseInline('[x](javascript:alert(1))').every((n) => n.t === 'text')).toBe(true);
    expect(inlineText(parseInline('a * b and 2 ** 3'))).toBe('a * b and 2 ** 3');
    expect(parseInline('snake_case_name').every((n) => n.t === 'text')).toBe(true);
  });
});

describe('parseMarkdown', () => {
  it('parses blocks', () => {
    const b = parseMarkdown('# Title\n\nPara one\ncontinues.\n\n- a\n- b\n\n1. x\n2. y\n\n> quote\n\n```\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'code', 'table']);
    const p = b[1];
    expect(p.t === 'p' && inlineText(p.c)).toBe('Para one continues.');
    const t = b[6];
    expect(t.t === 'table' && t.rows.length).toBe(1);
  });
  it('parses the fixture answer into paragraphs with bold numbers', () => {
    const rec = loadFixture<AgentRecommendation>('agent-recommendation.json');
    const b = parseMarkdown(rec.answer);
    expect(b.length).toBe(3);
    expect(b.every((x) => x.t === 'p')).toBe(true);
    const first = b[0];
    expect(first.t === 'p' && first.c.some((n) => n.t === 'strong' && inlineText(n.c) === '−2.0 °C')).toBe(true);
  });
  it('handles empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
  });
});
