import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';

/** Foundation placeholder for a feature page that its owner is rebuilding for v1. */
export function Placeholder({ title, owner, children }: { title: string; owner: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="rounded-card border border-dashed border-line bg-surface p-6">
        <div className="flex items-center gap-2 text-ink">
          <Construction size={18} />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">Placeholder from the app foundation. {owner} is building this page for v1.</p>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}
