/**
 * URLs of the BrotIA platform. The app lives under `/app` (the landing page owns `/`, the presentation `/welcome`).
 * Build every in-app link and navigate() target with these, never with a bare '/portfolios…' string.
 * App.tsx declares its routes relative to the `/app/*` mount in main.tsx; the old root URLs redirect (RootRoutes).
 */
export const APP_ROOT = '/app';

/** `appPath()` → '/app'; `appPath('/portfolios/x')` → '/app/portfolios/x'. */
export function appPath(path = '/'): string {
  if (!path || path === '/') return APP_ROOT;
  return `${APP_ROOT}${path.startsWith('/') ? '' : '/'}${path}`;
}

export const paths = {
  home: APP_ROOT,
  incidents: appPath('/incidents'),
  portfolios: appPath('/portfolios'),
  newPortfolio: appPath('/portfolios/new'),
  portfolio: (portfolioId: string) => appPath(`/portfolios/${portfolioId}`),
  farm: (portfolioId: string, farmId: string) => appPath(`/portfolios/${portfolioId}/farms/${farmId}`),
} as const;
