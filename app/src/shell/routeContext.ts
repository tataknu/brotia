import { matchPath } from 'react-router-dom';
import { appPath } from './paths';

/** Portfolio/farm ids of the current route (under /app), for the agent's default context and the active nav item. */
export function routeContext(pathname: string): { portfolioId: string | null; farmId: string | null } {
  const farm = matchPath(appPath('/portfolios/:portfolioId/farms/:farmId'), pathname);
  if (farm) return { portfolioId: farm.params.portfolioId ?? null, farmId: farm.params.farmId ?? null };
  const pf = matchPath(appPath('/portfolios/:portfolioId'), pathname);
  if (pf && pf.params.portfolioId !== 'new') return { portfolioId: pf.params.portfolioId ?? null, farmId: null };
  return { portfolioId: null, farmId: null };
}
