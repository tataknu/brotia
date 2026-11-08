/** Crop templates for the wizard (GET /crops or the offline snapshot). Never invented: null when unavailable. */
import { useMemo } from 'react';
import type { Crop, CropTemplate } from '@/domain/types';
import { useCrops } from '@/data/hooks';

export interface TemplatesState {
  templates: CropTemplate[] | null;
  byCrop: Partial<Record<Crop, CropTemplate>>;
  loading: boolean;
  /** Plain-language reason when the templates could not be loaded. */
  error: string | null;
}

export function useTemplates(): TemplatesState {
  const { data, loading, error } = useCrops();
  return useMemo(() => {
    const byCrop: Partial<Record<Crop, CropTemplate>> = {};
    for (const t of data ?? []) byCrop[t.crop] = t;
    return {
      templates: data ?? null,
      byCrop,
      loading,
      error: !data && error ? ((error as { reason?: string }).reason ?? error.message) : null,
    };
  }, [data, loading, error]);
}
