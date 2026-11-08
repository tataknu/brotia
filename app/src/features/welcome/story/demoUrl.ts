/**
 * Target of the "Try it yourself" QR on the last welcome slide.
 * Order: VITE_DEMO_URL (build-time) → the current origin when served from a real host → the deployed demo.
 */
export const DEMO_URL_FALLBACK = 'https://brotia-two.vercel.app';

function resolveDemoUrl(): string {
  const env = (import.meta.env.VITE_DEMO_URL as string | undefined)?.trim();
  if (env) return env;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') return window.location.origin;
  }
  return DEMO_URL_FALLBACK;
}

export const DEMO_URL = resolveDemoUrl();
/** The URL as printed under the QR: no protocol, no trailing slash. */
export const DEMO_URL_LABEL = DEMO_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
