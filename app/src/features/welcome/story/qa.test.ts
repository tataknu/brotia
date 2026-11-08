import { describe, expect, it } from 'vitest';
import { isQaTarget, qaParam } from './qa';

// The vitest environment is `node` (no jsdom / Testing Library), so the guard WelcomePage uses on the slide's
// click and on document keydown is tested as a pure function with element-like stubs.
const el = (insideQa: boolean) => ({ closest: (sel: string) => (sel === '[data-qa]' && insideQa ? {} : null) });

describe('Q&A event guard', () => {
  it('claims events from inside a Q&A card or panel, so they do not advance the deck', () => {
    expect(isQaTarget(el(true) as unknown as EventTarget)).toBe(true);
  });
  it('leaves other slide clicks and keys to the deck', () => {
    expect(isQaTarget(el(false) as unknown as EventTarget)).toBe(false);
    expect(isQaTarget(null)).toBe(false);
    expect(isQaTarget({} as EventTarget)).toBe(false); // document / window: no closest()
  });
  it('reads ?qa=N as a 1-based card index', () => {
    expect(qaParam('?scene=9&qa=2', 6)).toBe(1);
    expect(qaParam('?qa=0', 6)).toBeNull();
    expect(qaParam('?qa=7', 6)).toBeNull();
    expect(qaParam('', 6)).toBeNull();
  });
});
