# ADR-0027: Landing page at `/`, platform under `/app`

- **Status:** Accepted
- **Date:** 2026-11-09
- **Amends:** [ADR-0024](0024-brotia-brand-and-v1-1-information-architecture.md) (routes)

## Context

People reach BrotIA from the QR codes in the deck and on the deployed site. Landing straight inside the
platform skips the story; the deck itself (`/welcome`) is built for presenting, not for reading on a phone.

## Decisions

### D1. Routes
- `/`: the landing page, outside the app shell.
- `/welcome`: the presentation, unchanged; its last step now enters `/app`.
- `/app/*`: the platform. Home is `/app`; incidents, portfolios, reports and farms live under it.
- Old links (`/incidents`, `/portfolios`, `/portfolios/*`) redirect to the same path under `/app`, keeping the
  query string and hash. Unknown paths under `/app` go to `/app`; any other unknown path goes to `/`.
- Every internal link is built with `@/shell/paths` (`paths.home`, `paths.portfolio(id)`, `paths.farm(p, f)`, …);
  no bare `'/portfolios…'` strings for navigation.

### D2. The landing page is a scroll story made from the deck's own scenes
- Desktop: each section is a tall block with a sticky 16:9 stage; scene time comes from scroll
  (`t = progress · scene.dur`, holding the final frame for the last 18 % of the block), so scrolling plays and
  rewinds the real slides. Stages mount only near the viewport.
- Phones (< 900 px): stacked sections with headline, caption and key numbers in HTML, plus each scene's final
  frame in a swipeable card. No horizontal page scroll.
- The hero offers **Open the platform** (`/app`) and **Watch the story** (`/welcome`); the platform's data is
  warmed in the background while visitors scroll.

## Consequences
- The QR codes keep pointing at the site root, which is now the landing page.
- Tests that render `<App/>` mount it under `/app/*`.
