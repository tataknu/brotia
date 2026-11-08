/**
 * Farming agent side panel (app-portfolio). Mounted by the shell (App.tsx) while agentPanel.open is true.
 *
 * - Asks POST /agent/recommend about the whole portfolio, one zone or one farm (exactly one of zoneId/farmId).
 * - Shows the answer (Markdown), the evidence (backtest table), the tool-call trace (collapsed) and every
 *   proposal as a diff card. The agent only proposes: Apply / Dismiss go through the store's audit trail
 *   (proposal actor = agent; the applied/dismissed copy actor = the user, recommendationId set).
 * - 503 no_api_key → a setup message (set ANTHROPIC_API_KEY for the service). Offline → unavailable.
 */
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Bot, Check, ChevronRight, CloudOff, KeyRound, Loader2, RotateCcw, Send, Sparkles, Trash2, Undo2, User, Wrench, X } from 'lucide-react';
import { activeZones, effectiveValueAt, proposalState } from '@/domain/rules';
import type { AgentRecommendation, CropTemplate, Portfolio, RuleChange } from '@/domain/types';
import { useConnection, useCrops, usePortfolioAssessment, useRecommend } from '@/data/hooks';
import { usePortfolio, useRecommendations, useStore } from '@/state/store';
import { Badge, Button, Select } from '@/shared/ui';
import { signed, timestampUTC } from '@/shared/format';
import { Markdown } from './Markdown';
import {
  promptsFor,
  agentErrorInfo,
  bestRowIndex,
  contextForPrompt,
  contextLabel,
  describeChange,
  evidenceTable,
  formatValue,
  normaliseContext,
  scopeLabel,
  targetExists,
  zoneName,
  type AgentContext,
  type AgentErrorInfo,
} from './agentModel';

export function AgentPanel() {
  const panel = useStore((s) => s.agentPanel);
  const closeAgent = useStore((s) => s.closeAgent);
  const openAgent = useStore((s) => s.openAgent);
  const portfolio = usePortfolio(panel.portfolioId ?? undefined);
  const recs = useRecommendations(portfolio?.id);
  const addRecommendation = useStore((s) => s.addRecommendation);
  const clearRecommendations = useStore((s) => s.clearRecommendations);
  const { data: templates } = useCrops();
  const { mode, health } = useConnection();
  const agent = useRecommend();
  // Ranked farms help pick a sensible farm/zone for the suggested prompts (cached when the dashboard loaded it).
  const { data: assessment } = usePortfolioAssessment(panel.farmId ? null : portfolio);

  const ctx: AgentContext = normaliseContext({ zoneId: panel.zoneId, farmId: panel.farmId });
  const setCtx = (next: AgentContext) => openAgent({ portfolioId: panel.portfolioId, ...normaliseContext(next) });

  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<{ question: string; ctx: AgentContext; startedAt: number } | null>(null);
  const [lastAsked, setLastAsked] = useState<{ question: string; ctx: AgentContext } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [recs.length, pending, agent.error]);

  const offline = mode === 'snapshot';
  const noKey = mode === 'live' && health?.agentAvailable === false;

  const ask = async (text: string, askCtx: AgentContext) => {
    const q = text.trim();
    if (!q || !portfolio || pending) return;
    setPending({ question: q, ctx: askCtx, startedAt: Date.now() });
    setLastAsked({ question: q, ctx: askCtx });
    setQuestion('');
    try {
      const rec = await agent.run({ portfolio, zoneId: askCtx.zoneId, farmId: askCtx.farmId, question: q });
      if (rec) addRecommendation(portfolio.id, rec);
    } finally {
      setPending(null);
    }
  };

  // useRecommend keeps the last error until the next run (or reset).
  const error: AgentErrorInfo | null = !pending && agent.error ? agentErrorInfo(agent.error) : null;

  const contextOptions = useMemo(() => buildContextOptions(portfolio), [portfolio]);
  const ctxValue = ctx.farmId ? `farm:${ctx.farmId}` : ctx.zoneId ? `zone:${ctx.zoneId}` : 'portfolio';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <Bot size={18} className="text-brand" />
        <h2 className="flex-1 text-sm font-semibold text-ink">Farming agent</h2>
        {portfolio && recs.length > 0 && (
          <button
            type="button"
            className="rounded-card p-1.5 text-muted hover:bg-surface hover:text-ink"
            aria-label="Clear the conversation"
            title="Clear the conversation (applied changes stay in the audit trail)"
            onClick={() => {
              clearRecommendations(portfolio.id);
              agent.reset();
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
        <button className="rounded-card p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label="Close the farming agent" onClick={closeAgent}>
          <X size={16} />
        </button>
      </div>

      {!portfolio ? (
        <div className="p-4 text-sm text-muted">Open a portfolio to ask the farming agent about its zones and farms.</div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {offline && (
              <Notice icon={<CloudOff size={16} />} title="The farming agent is unavailable offline">
                It needs the live service. The offline snapshot cannot answer questions.
              </Notice>
            )}
            {noKey && <SetupNotice />}

            {recs.length === 0 && !pending && (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Ask about frost, harvest rain, water or why a farm is on the watchlist. The agent answers from the service&apos;s data tools and
                  backtests, and only <span className="font-medium text-ink">proposes</span> rule changes: nothing changes until you apply them.
                </p>
              </div>
            )}

            {recs.map((rec) => (
              <Exchange key={rec.id} rec={rec} portfolio={portfolio} templates={templates} />
            ))}

            {pending && (
              <>
                <UserBubble text={pending.question} context={contextLabel(portfolio, pending.ctx)} />
                <Thinking startedAt={pending.startedAt} />
              </>
            )}

            {error && (
              <div role="alert" className="space-y-2">
                {lastAsked && <UserBubble text={lastAsked.question} context={contextLabel(portfolio, lastAsked.ctx)} />}
                {error.kind === 'no_api_key' ? (
                  noKey ? null : <SetupNotice />
                ) : (
                  <Notice tone={error.kind === 'offline' ? 'warn' : 'danger'} icon={<AlertTriangle size={16} />} title={error.title}>
                    {error.message}
                  </Notice>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-line p-3">
            <div className="flex items-center gap-2">
              <label htmlFor="agent-context" className="shrink-0 text-xs text-muted">
                Asking about
              </label>
              <Select
                id="agent-context"
                className="min-w-0 flex-1 [&_select]:py-1.5 [&_select]:text-xs"
                value={ctxValue}
                options={contextOptions}
                onChange={(e) => {
                  const [kind, id] = splitOption(e.target.value);
                  setCtx(kind === 'farm' ? { farmId: id, zoneId: null } : kind === 'zone' ? { zoneId: id, farmId: null } : { zoneId: null, farmId: null });
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {promptsFor(ctx, assessment?.ranked.find((r) => r.farmId === ctx.farmId)?.tier ?? null).map((p) => (
                <button
                  key={p.text}
                  type="button"
                  disabled={!!pending || offline}
                  onClick={() => {
                    const next = contextForPrompt(portfolio, ctx, p.kind, assessment?.ranked);
                    setCtx(next);
                    void ask(p.text, next);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-left text-xs text-ink hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles size={14} className="shrink-0 text-brand" />
                  {p.text}
                </button>
              ))}
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(question, ctx);
              }}
            >
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question, ctx);
                  }
                }}
                rows={2}
                aria-label="Question for the farming agent"
                placeholder={offline ? 'Needs the live service' : `Ask about ${contextLabel(portfolio, ctx)}…`}
                disabled={offline}
                className="min-h-[44px] w-full flex-1 resize-none rounded-card border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-surface"
              />
              <Button type="submit" size="sm" disabled={!question.trim() || !!pending || offline} aria-label="Ask" icon={pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} />
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── context options ───────────────────────── */

function buildContextOptions(portfolio: Portfolio | undefined) {
  if (!portfolio) return [{ value: 'portfolio', label: 'Whole portfolio' }];
  const zones = activeZones(portfolio);
  return [
    { value: 'portfolio', label: 'Whole portfolio' },
    ...zones.map((z) => ({ value: `zone:${z.id}`, label: `Zone · ${zoneName(portfolio, z.id)}` })),
    ...portfolio.farms.map((f) => ({ value: `farm:${f.id}`, label: `Farm · ${f.name}` })),
  ];
}

function splitOption(v: string): ['portfolio' | 'zone' | 'farm', string | null] {
  const i = v.indexOf(':');
  if (i < 0) return ['portfolio', null];
  return [v.slice(0, i) as 'zone' | 'farm', v.slice(i + 1)];
}

/* ───────────────────────── pieces ───────────────────────── */

function Notice({ icon, title, children, tone = 'warn' }: { icon: ReactNode; title: string; children: ReactNode; tone?: 'warn' | 'danger' }) {
  return (
    <div className={clsx('rounded-card border px-3 py-2.5 text-sm', tone === 'danger' ? 'border-danger/30 bg-danger-soft' : 'border-warn/30 bg-warn-soft')}>
      <p className={clsx('flex items-center gap-2 font-medium', tone === 'danger' ? 'text-danger' : 'text-warn')}>
        {icon}
        {title}
      </p>
      <div className="mt-1 text-ink">{children}</div>
    </div>
  );
}

function SetupNotice() {
  return (
    <Notice icon={<KeyRound size={16} />} title="The farming agent is not set up yet">
      <p>The service has no Anthropic API key, so it cannot answer. To turn it on:</p>
      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
        <li>
          Set <code className="rounded bg-white/70 px-1 font-mono text-xs">ANTHROPIC_API_KEY</code> in the service environment, or in the gitignored{' '}
          <code className="rounded bg-white/70 px-1 font-mono text-xs">service/.env</code>.
        </li>
        <li>Restart the service, then ask again.</li>
      </ol>
      <p className="mt-1.5 text-muted">The key stays on the service. The app never sees it.</p>
    </Notice>
  );
}

function UserBubble({ text, context }: { text: string; context: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[90%] rounded-card bg-brand-soft px-3 py-2 text-sm text-ink">
        <p className="flex items-center gap-1.5 text-xs text-brand-ink">
          <User size={14} />
          {context}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

function Thinking({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="flex items-center gap-2 rounded-card border border-line px-3 py-2.5 text-sm text-muted">
      <Loader2 size={16} className="animate-spin text-brand" />
      Reading history, events and backtests… <span className="tabular-nums">{s} s</span>
    </div>
  );
}

function Exchange({ rec, portfolio, templates }: { rec: AgentRecommendation; portfolio: Portfolio; templates: CropTemplate[] | undefined }) {
  const ctx = normaliseContext({ zoneId: rec.zoneId ?? null, farmId: rec.farmId ?? null });
  return (
    <div className="space-y-2">
      <UserBubble text={rec.question} context={contextLabel(portfolio, ctx)} />
      <div className="space-y-3 rounded-card border border-line bg-white px-3 py-3 shadow-panel">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Bot size={14} className="text-brand" />
          Farming agent · {timestampUTC(rec.createdAt)}
        </p>
        <Markdown source={rec.answer} />

        {rec.evidence.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Evidence</p>
            {rec.evidence.map((ev, i) => (
              <Evidence key={i} ev={ev} />
            ))}
          </div>
        )}

        {rec.proposals.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Proposed changes · nothing changes until you apply</p>
            {rec.proposals.map((p) => (
              <ProposalCard key={p.id} rec={rec} proposal={p} portfolio={portfolio} templates={templates} />
            ))}
          </div>
        )}

        {rec.toolCalls.length > 0 && (
          <details className="group rounded-card bg-surface px-3 py-2 text-xs">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted hover:text-ink">
              <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
              <Wrench size={14} />
              Tool calls ({rec.toolCalls.length}) · every number in the answer comes from these
            </summary>
            <ol className="mt-2 space-y-2">
              {rec.toolCalls.map((t, i) => (
                <li key={i} className="space-y-0.5">
                  <p className="font-mono text-ink">
                    {i + 1}. {t.name}
                  </p>
                  <p className="break-all font-mono text-muted">{shortJson(t.input)}</p>
                  <p className="flex gap-1 text-ink">
                    <ArrowRight size={12} className="mt-0.5 shrink-0 text-muted" />
                    {t.outputSummary}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-muted">Model: {rec.model}</p>
          </details>
        )}
      </div>
    </div>
  );
}

function shortJson(v: unknown, max = 220): string {
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s && s.length > max ? `${s.slice(0, max)}…` : (s ?? '');
}

const EVIDENCE_LABEL = { backtest: 'Backtest', history: 'History', event: 'Event' } as const;

function Evidence({ ev }: { ev: AgentRecommendation['evidence'][number] }) {
  const table = useMemo(() => evidenceTable(ev.data), [ev.data]);
  const best = table ? bestRowIndex(table) : -1;
  return (
    <div className="rounded-card border border-line px-3 py-2">
      <div className="flex items-start gap-2">
        <Badge tone={ev.kind === 'backtest' ? 'brand' : ev.kind === 'event' ? 'warn' : 'info'}>{EVIDENCE_LABEL[ev.kind] ?? ev.kind}</Badge>
        <p className="min-w-0 flex-1 text-sm text-ink">{ev.summary}</p>
      </div>
      {table ? (
        <div className="mt-2 overflow-x-auto">
          {(table.param || table.seasons) && (
            <p className="mb-1 text-xs text-muted">
              {table.param && <span className="font-mono">{table.param}</span>}
              {table.param && table.seasons ? ' · ' : ''}
              {table.seasons ? `${table.seasons} seasons` : ''}
            </p>
          )}
          <table className="w-full text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-line text-muted">
                {table.columns.map((c) => (
                  <th key={c.key} className="px-2 py-1 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className={clsx('border-b border-line/60 last:border-0', i === best && 'bg-brand-soft/60')}>
                  {table.columns.map((c) => (
                    <td key={c.key} className="px-2 py-1 text-ink">
                      {cell(r[c.key], c.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {best >= 0 && <p className="mt-1 text-xs text-muted">Highlighted: most hits, then fewest false alarms.</p>}
        </div>
      ) : ev.data !== null && ev.data !== undefined ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-muted hover:text-ink">Data</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-card bg-surface p-2 font-mono">{JSON.stringify(ev.data, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function cell(v: string | number | boolean | null | undefined, key?: string): string {
  if (v === null || v === undefined) return '–';
  // one formatter per column (RT-7): candidate values always with one decimal and a true minus
  if (typeof v === 'number') return key === 'value' ? signed(v, 1) : Number.isInteger(v) ? signed(v, 0) : signed(v, 2);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v;
}

function ProposalCard({ rec, proposal, portfolio, templates }: { rec: AgentRecommendation; proposal: RuleChange; portfolio: Portfolio; templates: CropTemplate[] | undefined }) {
  const applyProposal = useStore((s) => s.applyProposal);
  const dismissProposal = useStore((s) => s.dismissProposal);
  const revertChange = useStore((s) => s.revertChange);
  const state = proposalState(portfolio, rec, proposal);
  const d = describeChange(proposal, portfolio, templates);
  const exists = targetExists(proposal.scope, portfolio);
  const current = exists && templates ? effectiveValueAt(portfolio, templates, proposal.scope, proposal.path) : undefined;
  const decision = useMemo(
    () =>
      [...portfolio.audit]
        .reverse()
        .find((c) => c.recommendationId === rec.id && c.scope.level === proposal.scope.level && c.scope.id === proposal.scope.id && c.path === proposal.path && c.status !== 'proposed'),
    [portfolio.audit, rec.id, proposal],
  );
  const currentDiffers = state === 'proposed' && current !== undefined && JSON.stringify(current ?? null) !== JSON.stringify(proposal.oldValue ?? null);
  // An applied proposal can be undone while it is still the latest applied change at its path.
  const latestAtPath = [...portfolio.audit].reverse().find((c) => c.status === 'applied' && c.scope.level === proposal.scope.level && c.scope.id === proposal.scope.id && c.path === proposal.path);
  const canUndo = state === 'applied' && decision && latestAtPath?.id === decision.id;

  return (
    <div className={clsx('rounded-card border px-3 py-2.5', state === 'applied' ? 'border-brand/40 bg-brand-soft/40' : state === 'dismissed' ? 'border-line bg-surface/60' : 'border-line bg-white')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted">{scopeLabel(proposal.scope, portfolio)}</p>
        {state === 'applied' && (
          <Badge tone="brand">
            <Check size={12} />
            Applied
          </Badge>
        )}
        {state === 'dismissed' && <Badge>Dismissed</Badge>}
        {state === 'proposed' && <Badge tone="info">Proposed</Badge>}
      </div>
      <p className="mt-1 text-sm font-medium text-ink">{d.label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm tabular-nums">
        <span className={clsx('rounded px-1.5 py-0.5', state === 'dismissed' ? 'text-muted' : 'bg-danger-soft text-danger line-through decoration-danger/50')}>{formatValue(proposal.oldValue, d)}</span>
        <ArrowRight size={14} className="text-muted" />
        <span className={clsx('rounded px-1.5 py-0.5 font-semibold', state === 'dismissed' ? 'text-muted' : 'bg-brand-soft text-brand-ink')}>{formatValue(proposal.newValue, d)}</span>
      </div>
      {currentDiffers && <p className="mt-1 text-xs text-warn">The current value is {formatValue(current, d)}, not the agent&apos;s starting point.</p>}
      <p className="mt-1.5 text-sm text-ink">{proposal.reason}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-muted">{proposal.path}</p>

      {state === 'proposed' ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            icon={<Check size={16} />}
            disabled={!exists || !templates}
            title={!exists ? 'This zone or farm is no longer in the portfolio' : !templates ? 'Loading crop templates…' : undefined}
            onClick={() => applyProposal(portfolio.id, rec.id, proposal.id, templates)}
          >
            Apply
          </Button>
          <Button size="sm" variant="secondary" icon={<X size={16} />} onClick={() => dismissProposal(portfolio.id, rec.id, proposal.id, templates)}>
            Dismiss
          </Button>
          {!exists && <span className="text-xs text-muted">Target no longer exists</span>}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>
            Proposed by {proposal.actor.name || 'Farming agent'} · {state === 'applied' ? 'applied' : 'dismissed'} by {decision?.actor.name ?? 'you'}
            {decision ? ` · ${timestampUTC(decision.at)}` : ''}
          </span>
          {canUndo && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-card px-1.5 py-0.5 font-medium text-ink hover:bg-surface"
              onClick={() => revertChange(portfolio.id, decision!.id, templates)}
            >
              <Undo2 size={14} />
              Undo
            </button>
          )}
          {state === 'applied' && !canUndo && decision && latestAtPath && latestAtPath.id !== decision.id && (
            <span className="inline-flex items-center gap-1">
              <RotateCcw size={12} />
              changed again later
            </span>
          )}
        </div>
      )}
    </div>
  );
}
