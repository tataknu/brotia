/**
 * A portfolio's display name with its short fund/book code in mono before it (ADR-0026 D6):
 * "CLSF1 · Chile Specialty Fruit Credit I". Portfolios without a code show the name alone.
 */
export function portfolioLabel(p: { name?: string | null; code?: string | null }): string {
  const name = p.name || 'Untitled portfolio';
  return p.code ? `${p.code} · ${name}` : name;
}

export function PortfolioName({ name, code }: { name?: string | null; code?: string | null }) {
  const n = name || 'Untitled portfolio';
  if (!code) return <>{n}</>;
  return (
    <>
      <span className="font-mono">{code}</span>
      <span aria-hidden> · </span>
      {n}
    </>
  );
}
