/**
 * App shell + routes (docs/design/v1.1-ui-spec.md, Layout and Routes).
 * Layout: [left sidebar | (offline banner / [main (scrolls) | agent side panel])]. Pages own their padding.
 * - Sidebar (src/shell/Sidebar.tsx): 240 px from 1024 px, icons only from 640 px, a drawer with a top bar below 640 px.
 * - The agent panel content is features/agent/AgentPanel.tsx; open it from any page with
 *   useStore.getState().openAgent({ portfolioId, zoneId?, farmId? }). The sidebar toggle opens it with the route context.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { HomePage } from '@/features/home/HomePage';
import { IncidentsPage } from '@/features/incidents/IncidentsPage';
import { PortfoliosPage } from '@/features/portfolios/PortfoliosPage';
import { WizardPage } from '@/features/wizard/WizardPage';
import { PortfolioReportPage } from '@/features/report/PortfolioReportPage';
import { FarmPage } from '@/features/farm/FarmPage';
import { AgentPanel } from '@/features/agent/AgentPanel';
import { OfflineBanner } from '@/shared/ui';
import { BrotiaLogo } from '@/shared/brand/BrotiaLogo';
import { useStore } from '@/state/store';
import { bootstrapSamples } from '@/state/samples';
import { ConnectionDot, SidebarNav } from '@/shell/Sidebar';
import { routeContext } from '@/shell/routeContext';
import { paths } from '@/shell/paths';

export default function App() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const agentOpen = useStore((s) => s.agentPanel.open);
  const openAgent = useStore((s) => s.openAgent);
  const closeAgent = useStore((s) => s.closeAgent);

  // First start: load the sample portfolios; later starts: refresh stored samples' names (ADR-0026 D6).
  useEffect(() => {
    void bootstrapSamples();
  }, []);

  // The page scrolls inside <main>, so reset it on every route change; the drawer closes on navigation.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    setDrawerOpen(false);
  }, [pathname]);

  // Drawer: Escape closes it; focus moves into it on open and back to the menu button on close.
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const menu = menuRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      menu?.focus();
    };
  }, [drawerOpen]);

  // Same behaviour as before the redesign: the agent opens with the portfolio/farm of the current route.
  const toggleAgent = useCallback(() => {
    if (agentOpen) closeAgent();
    else {
      const ctx = routeContext(pathname);
      openAgent({ portfolioId: ctx.portfolioId, farmId: ctx.farmId, zoneId: null });
    }
    setDrawerOpen(false);
  }, [agentOpen, closeAgent, openAgent, pathname]);

  return (
    <div className="flex h-screen bg-white font-sans text-ink">
      {/* Desktop and tablet sidebar */}
      <aside aria-label="Sidebar" className="hidden w-16 shrink-0 flex-col border-r border-line bg-white sm:flex lg:w-60">
        <SidebarNav variant="rail" onToggleAgent={toggleAgent} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-2 sm:hidden">
          <button
            ref={menuRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-card text-ink hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <Menu size={20} />
          </button>
          <Link to={paths.home} aria-label="BrotIA home" className="rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
            <BrotiaLogo size={22} />
          </Link>
          <div className="flex-1" />
          <ConnectionDot className="mr-2" />
        </header>

        <OfflineBanner />

        <div className="flex min-h-0 flex-1">
          <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white">
            <Routes>
              {/* Relative to the /app/* mount in main.tsx (src/shell/paths.ts) */}
              <Route index element={<HomePage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="portfolios" element={<PortfoliosPage />} />
              <Route path="portfolios/new" element={<WizardPage />} />
              <Route path="portfolios/:portfolioId" element={<PortfolioReportPage />} />
              <Route path="portfolios/:portfolioId/farms/:farmId" element={<FarmPage />} />
              <Route path="*" element={<Navigate to={paths.home} replace />} />
            </Routes>
          </main>
          {agentOpen && (
            <aside aria-label="Farming agent" className="flex w-full max-w-md shrink-0 flex-col border-l border-line bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-[1050] max-lg:shadow-panel">
              <AgentPanel />
            </aside>
          )}
        </div>
      </div>

      {/* Phone drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[1080] sm:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-white outline-none"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-2 top-3 inline-flex h-10 w-10 items-center justify-center rounded-card text-muted hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <X size={18} />
            </button>
            <SidebarNav variant="drawer" onNavigate={() => setDrawerOpen(false)} onToggleAgent={toggleAgent} />
          </div>
        </div>
      )}
    </div>
  );
}
