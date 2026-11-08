import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, FilePlus, FolderOpen, Plus } from 'lucide-react';
import { useStore } from '@/state/store';
import { makeSamplePortfolio } from '@/data/api';
import { Button, EmptyState, Modal } from '@/shared/ui';
import { PortfolioCard } from './PortfolioCard';

export function PortfoliosPage() {
  const portfolios = useStore((s) => s.portfolios);
  const draft = useStore((s) => s.draft);
  const addPortfolio = useStore((s) => s.addPortfolio);
  const deletePortfolio = useStore((s) => s.deletePortfolio);
  const startDraft = useStore((s) => s.startDraft);
  const discardDraft = useStore((s) => s.discardDraft);
  const navigate = useNavigate();
  const [confirmNew, setConfirmNew] = useState(false);

  const sorted = useMemo(() => [...portfolios].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [portfolios]);

  const loadSample = () => {
    const p = makeSamplePortfolio();
    addPortfolio(p);
    navigate(`/portfolios/${p.id}`);
  };
  const newPortfolio = () => {
    startDraft();
    navigate('/portfolios/new');
  };
  const onNew = () => (draft ? setConfirmNew(true) : newPortfolio());

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Portfolios</h1>
          <p className="mt-1 text-sm text-muted">Farm loan books monitored against each field’s own climate history.</p>
        </div>
        {sorted.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Database size={16} />} onClick={loadSample}>
              Load sample portfolio
            </Button>
            <Button icon={<Plus size={16} />} onClick={onNew}>
              New portfolio
            </Button>
          </div>
        )}
      </div>

      {draft && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <FilePlus size={18} className="shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">Unfinished portfolio: {draft.name.trim() || 'Untitled portfolio'}</p>
              <p className="text-sm text-muted">
                {draft.farms.length} {draft.farms.length === 1 ? 'farm' : 'farms'} drawn so far.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={discardDraft}>
              Discard draft
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/portfolios/new')}>
              Continue draft
            </Button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          className="py-16"
          icon={<FolderOpen size={18} />}
          title="No portfolios yet"
          description="Create a portfolio by drawing your financed farms on the map, or load a sample loan book from the Santa Cruz soy belt to explore the dashboard."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" icon={<Database size={16} />} onClick={loadSample}>
                Load sample portfolio
              </Button>
              <Button icon={<Plus size={16} />} onClick={onNew}>
                New portfolio
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <PortfolioCard key={p.id} portfolio={p} onDelete={() => deletePortfolio(p.id)} />
          ))}
        </div>
      )}

      {confirmNew && (
        <Modal
          title="Start a new portfolio?"
          onClose={() => setConfirmNew(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmNew(false)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => navigate('/portfolios/new')}>
                Continue draft
              </Button>
              <Button variant="danger" onClick={newPortfolio}>
                Discard and start new
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">You have an unfinished portfolio. Starting a new one discards it.</p>
        </Modal>
      )}
    </div>
  );
}

export default PortfoliosPage;
