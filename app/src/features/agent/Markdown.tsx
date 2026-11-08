/** Renders parseMarkdown() output as React elements (never raw HTML). */
import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from './mdParse';

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-ink">
            {renderInline(n.c)}
          </strong>
        );
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>;
      case 'code':
        return (
          <code key={i} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em]">
            {n.v}
          </code>
        );
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer noopener" className="text-brand underline hover:text-brand-hover">
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'h':
      return (
        <p key={i} className="font-semibold text-ink">
          {renderInline(b.c)}
        </p>
      );
    case 'ul':
      return (
        <ul key={i} className="list-disc space-y-1 pl-5">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} className="list-decimal space-y-1 pl-5">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case 'quote':
      return (
        <blockquote key={i} className="border-l-2 border-line pl-3 text-muted">
          {renderInline(b.c)}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={i} className="overflow-x-auto rounded-card bg-surface p-3 font-mono text-xs">
          {b.v}
        </pre>
      );
    case 'table':
      return (
        <div key={i} className="overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-line text-muted">
                {b.head.map((c, j) => (
                  <th key={j} className="px-2 py-1 font-medium">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j} className="border-b border-line/60 last:border-0">
                  {r.map((c, k) => (
                    <td key={k} className="px-2 py-1">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className={className ?? 'space-y-2 text-sm leading-relaxed text-ink'}>{blocks.map(renderBlock)}</div>;
}
