import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import App from './App';
import { LandingPage } from './features/landing/LandingPage';
import { WelcomePage } from './features/welcome/WelcomePage';
import { APP_ROOT, appPath } from './shell/paths';
import './index.css';

/** The platform used to live at the root: send `/incidents` and `/portfolios/*` to the same path under /app (query and hash kept). */
function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={{ pathname: appPath(pathname), search, hash }} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Landing page, outside the app shell */}
        <Route path="/" element={<LandingPage />} />
        {/* Title screen for the video, outside the app shell */}
        <Route path="/welcome" element={<WelcomePage />} />
        {/* The BrotIA platform; App.tsx declares its routes relative to this mount (src/shell/paths.ts) */}
        <Route path={`${APP_ROOT}/*`} element={<App />} />
        <Route path="/incidents" element={<LegacyRedirect />} />
        <Route path="/portfolios/*" element={<LegacyRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
