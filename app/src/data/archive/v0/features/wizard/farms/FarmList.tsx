/** Side panel list of draft farms with an inline editor (name, crop, sowing date, shape). */
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { Check, ChevronUp, PenLine, Shapes, Trash2, X } from 'lucide-react';
import { CROPS, CROP_TYPES, type CropType, type Farm } from '@/domain/types';
import { Button, Field, Input, Select } from '@/shared/ui';
import { date as fmtDate } from '@/shared/format';
import { areaLabel, isNameTaken, uniqueFarmName } from './farmHelpers';

const CROP_OPTIONS = CROP_TYPES.map((c) => ({ value: c, label: CROPS[c].label }));

export function CropPill({ crop }: { crop: CropType }) {
  const info = CROPS[crop];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: info?.color }} />
      {info?.label ?? crop}
    </span>
  );
}

export interface FarmRowProps {
  farm: Farm;
  farms: Farm[];
  selected: boolean;
  expanded: boolean;
  shapeEditing: boolean;
  /** Focus the name input when the editor opens (right after drawing). */
  autoFocusName: boolean;
  onSelect: (id: string) => void;
  onToggleEdit: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Omit<Farm, 'id'>>) => void;
  onDelete: (id: string) => void;
  onStartShapeEdit: (id: string) => void;
  onFinishShapeEdit: () => void;
  onCancelShapeEdit: () => void;
}

export function FarmRow({
  farm,
  farms,
  selected,
  expanded,
  shapeEditing,
  autoFocusName,
  onSelect,
  onToggleEdit,
  onUpdate,
  onDelete,
  onStartShapeEdit,
  onFinishShapeEdit,
  onCancelShapeEdit,
}: FarmRowProps) {
  const rowRef = useRef<HTMLLIElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  useEffect(() => {
    if (expanded && autoFocusName) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [expanded, autoFocusName]);

  const nameEmpty = !farm.name.trim();
  const duplicate = isNameTaken(farms, farm.id, farm.name);
  const typicalSow = CROPS[farm.crop]?.typicalSowMonthDay;

  return (
    <li
      ref={rowRef}
      className={clsx(
        'rounded-card border bg-white transition-colors',
        selected ? 'border-brand ring-2 ring-brand/15' : 'border-line hover:border-muted/40',
      )}
    >
      <div className="flex items-center gap-2 py-2 pl-3 pr-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-card py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          onClick={() => onSelect(farm.id)}
          aria-pressed={selected}
        >
          <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: CROPS[farm.crop]?.color }} />
          <span className="min-w-0 flex-1">
            <span className={clsx('block truncate text-sm font-medium', nameEmpty ? 'text-muted' : 'text-ink')}>{farm.name.trim() || 'Unnamed farm'}</span>
            <span className="mt-0.5 flex items-center gap-2">
              <CropPill crop={farm.crop} />
              <span className="text-xs tabular-nums text-muted">{areaLabel(farm.areaHa)}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          className="rounded-card p-1.5 text-muted hover:bg-surface hover:text-ink"
          aria-label={expanded ? `Close editor for ${farm.name}` : `Edit ${farm.name}`}
          aria-expanded={expanded}
          title={expanded ? 'Close' : 'Edit'}
          onClick={() => onToggleEdit(farm.id)}
        >
          {expanded ? <ChevronUp size={16} /> : <PenLine size={16} />}
        </button>
        <button
          type="button"
          className="rounded-card p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
          aria-label={`Delete ${farm.name}`}
          title="Delete"
          onClick={() => onDelete(farm.id)}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-line px-3 pb-3 pt-3">
          <Field
            label="Farm name"
            error={nameEmpty ? 'Give this farm a name.' : undefined}
            hint={duplicate ? 'Another farm already uses this name.' : undefined}
          >
            {(id) => (
              <Input
                id={id}
                ref={nameRef}
                value={farm.name}
                invalid={nameEmpty}
                onChange={(e) => onUpdate(farm.id, { name: e.target.value })}
                onBlur={() => {
                  if (!farm.name.trim()) onUpdate(farm.id, { name: uniqueFarmName(farms, farm.id) });
                  else if (farm.name !== farm.name.trim()) onUpdate(farm.id, { name: farm.name.trim() });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onToggleEdit(farm.id);
                }}
                placeholder="e.g. Estancia San Julián north"
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field label="Crop">
              {(id) => (
                <Select id={id} options={CROP_OPTIONS} value={farm.crop} onChange={(e) => onUpdate(farm.id, { crop: e.target.value as CropType })} />
              )}
            </Field>
            <Field
              label="Sowing date"
              hint={farm.sowingDate ? 'Optional.' : `Optional. Empty uses the usual date for this crop (${fmtDate(`2026-${typicalSow}`, 'short')}).`}
            >
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={farm.sowingDate ?? ''}
                  min="2020-01-01"
                  max="2030-12-31"
                  onChange={(e) => onUpdate(farm.id, { sowingDate: e.target.value || undefined })}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {shapeEditing ? (
              <>
                <Button size="sm" icon={<Check size={16} />} onClick={onFinishShapeEdit}>
                  Save shape
                </Button>
                <Button size="sm" variant="secondary" icon={<X size={16} />} onClick={onCancelShapeEdit}>
                  Cancel
                </Button>
                <p className="w-full text-xs text-muted">Drag the white points on the map to move corners. Drag a midpoint to add one.</p>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" icon={<Shapes size={16} />} onClick={() => onStartShapeEdit(farm.id)}>
                  Edit shape
                </Button>
                <Button size="sm" variant="ghost" icon={<Check size={16} />} onClick={() => onToggleEdit(farm.id)}>
                  Done
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
