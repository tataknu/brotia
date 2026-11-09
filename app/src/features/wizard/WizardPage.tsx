/**
 * Wizard shell (app-wizard): stepper, Back/Next, discard, commit.
 * Steps with a map (Farms, Zones & rules, Review) are lazy-loaded: Leaflet needs `window` at import time,
 * and the shell is server-rendered in the node smoke test.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Trash2 } from 'lucide-react';
import { COUNTRIES_FALLBACK, DEFAULT_COUNTRY } from '@/domain/constants';
import { useStore } from '@/state/store';
import { Button, Modal, Stepper } from '@/shared/ui';
import { StepPortfolio } from './portfolio/StepPortfolio';
import { StepCredit } from './credit/StepCredit';
import { LAST_STEP, WIZARD_STEPS, maxReachableStep, stepBlocker } from './gates';
import { paths } from '@/shell/paths';

const StepFarms = lazy(() => import('./farms/StepFarms'));
const StepZones = lazy(() => import('./zones/StepZones'));
const StepReview = lazy(() => import('./review/StepReview'));

const STEP_COMPONENTS = [StepPortfolio, StepFarms, StepZones, StepCredit, StepReview];

function StepLoading() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-sm text-muted">
      <Loader2 size={16} className="animate-spin" />
      Loading the map…
    </div>
  );
}

export function WizardPage() {
  const navigate = useNavigate();
  const draft = useStore((s) => s.draft);
  const storedStep = useStore((s) => s.wizardStep);
  const startDraft = useStore((s) => s.startDraft);
  const setWizardStep = useStore((s) => s.setWizardStep);
  const commitDraft = useStore((s) => s.commitDraft);
  const discardDraft = useStore((s) => s.discardDraft);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Set while committing/discarding so the "start a draft if none" effect does not recreate one on the way out.
  const leaving = useRef(false);

  useEffect(() => {
    if (!draft && !leaving.current) {
      const cl = COUNTRIES_FALLBACK.find((c) => c.code === DEFAULT_COUNTRY);
      startDraft({ country: DEFAULT_COUNTRY, currency: cl?.defaultCurrency ?? 'USD' });
    }
  }, [draft, startDraft]);

  const reachable = maxReachableStep(draft);
  // Never show a step whose prerequisites are no longer met (e.g. farms deleted after reaching Credit).
  const step = Math.min(Math.max(0, storedStep), reachable, LAST_STEP);
  const blocker = stepBlocker(step, draft);
  const isLast = step === LAST_STEP;
  const StepComponent = STEP_COMPONENTS[step];

  const goNext = () => {
    if (blocker) return;
    if (isLast) {
      leaving.current = true;
      const id = commitDraft();
      if (id) navigate(paths.portfolio(id));
      return;
    }
    setWizardStep(step + 1);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b border-line px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink">{draft?.name.trim() || 'New portfolio'}</h1>
          <p className="text-sm text-muted">
            Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step]}
          </p>
        </div>
        <Stepper steps={[...WIZARD_STEPS]} current={step} maxReachable={reachable} onSelect={(i) => setWizardStep(i)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {draft ? (
          <Suspense fallback={<StepLoading />}>
            <StepComponent />
          </Suspense>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-line bg-white px-4 py-3 sm:px-6">
        <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => setConfirmDiscard(true)}>
          Discard
        </Button>
        <div className="flex-1" />
        {blocker && <p className="hidden text-sm text-muted sm:block">{blocker}</p>}
        <Button variant="secondary" icon={<ArrowLeft size={16} />} disabled={step === 0} onClick={() => setWizardStep(step - 1)}>
          Back
        </Button>
        <Button onClick={goNext} disabled={!!blocker} title={blocker ?? undefined}>
          {isLast ? 'Create portfolio' : 'Next'}
          {isLast ? <Check size={16} /> : <ArrowRight size={16} />}
        </Button>
      </div>

      {confirmDiscard && (
        <Modal
          title="Discard this portfolio?"
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  leaving.current = true;
                  setConfirmDiscard(false);
                  navigate(paths.portfolios);
                  discardDraft();
                }}
              >
                Discard
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            The farms, zones, rule changes and loans you entered in this wizard will be removed. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default WizardPage;
