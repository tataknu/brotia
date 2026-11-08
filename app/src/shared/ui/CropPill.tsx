import clsx from 'clsx';
import { CROP_META } from '@/domain/constants';
import type { Crop } from '@/domain/types';

/** Crop pill with the crop colour dot. `lang="es"` shows the Spanish name. */
export function CropPill({ crop, lang = 'en', className }: { crop: Crop; lang?: 'en' | 'es'; className?: string }) {
  const m = CROP_META[crop];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-white px-2 py-0.5 text-xs font-medium text-ink', className)}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
      {lang === 'es' ? m.labelEs : m.label}
    </span>
  );
}

export const cropLabel = (crop: Crop, lang: 'en' | 'es' = 'en'): string => (lang === 'es' ? CROP_META[crop].labelEs : CROP_META[crop].label);
export const cropColor = (crop: Crop): string => CROP_META[crop].color;
