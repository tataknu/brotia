import { useEffect, useState } from 'react';
import { FlyInScene } from './FlyInScene';

const LOOP_MS = 5000;

/** Review harness: loops progress 0 → 1 every 5 s. `?p=0.9` in the URL freezes it at that value. */
export function FlyInPreview(): JSX.Element {
  const fixed = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('p') : null;
  const [progress, setProgress] = useState(fixed != null ? Number(fixed) : 0);

  useEffect(() => {
    if (fixed != null) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setProgress(((now - start) % LOOP_MS) / LOOP_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fixed]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0e1914' }}>
      <FlyInScene progress={progress} />
    </div>
  );
}

export default FlyInPreview;
