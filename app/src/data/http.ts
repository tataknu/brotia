/**
 * Low-level HTTP for the service client: timeouts, ApiError bodies, zod validation.
 * No auth, no custom headers beyond Content-Type (CONTRACT §B).
 */
import type { z } from 'zod';
import { ApiErrorSchema } from '@/domain/schemas';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Service base URL, no trailing slash. Override with VITE_SERVICE_URL. */
export const SERVICE_URL: string = (env.VITE_SERVICE_URL || 'http://localhost:8787').replace(/\/+$/, '');

/** Where the offline snapshot is served by the app (app/public/snapshot/). */
export const SNAPSHOT_BASE: string = `${(env.BASE_URL || '/').replace(/\/?$/, '/')}snapshot/`;

/** Timeouts in ms (CONTRACT §B: health 3 s, imagery 120 s, agent 90 s). */
export const TIMEOUTS = {
  health: 3_000,
  static: 20_000,
  events: 45_000,
  ciren: 45_000,
  assess: 300_000, // RT-2: a cold first assessment of a new portfolio can take several minutes
  imagery: 120_000,
  agent: 90_000,
  snapshotExport: 600_000,
  snapshotFile: 10_000,
} as const;

/** The service answered with a non-2xx ApiError body (or an unparseable error). Never falls back to the snapshot. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(status: number, code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Network failure or timeout: the service is unreachable. Triggers the snapshot fallback. */
export class NetworkError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, timedOut = false) {
    super(message);
    this.name = 'NetworkError';
    this.timedOut = timedOut;
  }
}

/** A response did not match the v1 contract (a bug on one side). */
export class ContractError extends Error {
  constructor(where: string, issues: string) {
    super(`Response from ${where} does not match the v1 contract: ${issues}`);
    this.name = 'ContractError';
  }
}

/** Offline (or the snapshot cannot answer this request). `reason` is plain language for the UI. */
export class UnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'UnavailableError';
    this.reason = reason;
  }
}

export function describeIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export function validate<T>(schema: z.ZodType<T>, data: unknown, where: string): T {
  const res = schema.safeParse(data);
  if (!res.success) throw new ContractError(where, describeIssues(res.error));
  return res.data;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** fetch + timeout + JSON. Throws NetworkError, ApiRequestError, or returns the parsed JSON body. */
export async function fetchJson(url: string, opts: RequestOptions): Promise<unknown> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new NetworkError(timedOut ? `Timed out after ${Math.round(opts.timeoutMs / 1000)} s: ${url}` : `Cannot reach ${url}`, timedOut);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error, parsed.data.detail);
    throw new ApiRequestError(res.status, `http_${res.status}`, text.slice(0, 200) || res.statusText);
  }
  if (json === undefined) throw new ContractError(url, 'body is not JSON');
  return json;
}
