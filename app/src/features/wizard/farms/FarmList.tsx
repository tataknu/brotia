/** Side panel list of draft farms with an inline editor (name, crop, covers, irrigation, planting year, shape). */
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { Check, ChevronUp, Database, PenLine, Shapes, Trash2, X } from 'lucide-react';
import { CROPS, type CropTemplate, type Farm } from '@/domain/types';
import { CROP_META } from '@/domain/constants';
import { todayUTC } from '@/domain/dates';
import type { FarmPatch } from '@/state/portfolio';
import { Button, CropPill, Field, Input, Select } from '@/shared/ui';
import { CommitNumberInput, Segmented } from '../common/inputs';
import { areaLabel, coverHint, fromTri, isNameTaken, plantingYearRange, titleCase, toTri, uniqueFarmName, type TriState } from './farmHelpers';

const CROP_OPTIONS = CROPS.map((c) => ({ value: c, label: CROP_META[c].label }));

export type AuditedFlag = 'covered' | 'irrigatedDeclared';

export interface FarmRowProps {
  farm: Farm;
  farms: Farm[];
  template: CropTemplate | undefined;
  selected: boolean;
  expanded: boolean;
  shapeEditing: boolean;
  /** Focus the name input when the editor opens (right after drawing). */
  autoFocusName: boolean;
  onSelect: (id: string) => void;
  onToggleEdit: (id: string) => void;
  onUpdate: (id: string, patch: FarmPatch) => void;
  /** Covered / irrigation flags are rule inputs: they go through the audit trail. */
  onSetFlag: (id: string, flag: AuditedFlag, value: boolean | null) => void;
  onDelete: (id: string) => void;
  onStartShapeEdit: (id: string) => void;
  onFinishShapeEdit: () => void;
  onCancelShapeEdit: () => void;
}

export function FarmRow({
  farm,
  farms,
  template,
  selected,
  expanded,
  shapeEditing,
  autoFocusName,
  onSelect,
  onToggleEdit,
  onUpdate,
  onSetFlag,
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
  const years = plantingYearRange(todayUTC());
  const hint = coverHint(farm.crop, farm.covered, template);
  const coveredDefault = template?.coveredDefault ?? false;

  return (
    <li
      ref={rowRef}
      className={clsx('rounded-card border bg-white transition-colors', selected ? 'border-brand ring-2 ring-brand/15' : 'border-line hover:border-muted/40')}
    >
      <div className="flex items-center gap-2 py-2 pl-3 pr-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-card py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          onClick={() => onSelect(farm.id)}
          aria-pressed={selected}
        >
          <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: CROP_META[farm.crop]?.color }} />
          <span className="min-w-0 flex-1">
            <span className={clsx('block truncate text-sm font-medium', nameEmpty ? 'text-muted' : 'text-ink')}>{farm.name.trim() || 'Unnamed farm'}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2">
              <CropPill crop={farm.crop} />
              <span className="text-xs tabular-nums text-muted">{areaLabel(farm.areaHa)}</span>
              {farm.ciren && (
                <span className="inline-flex items-center gap-1 text-xs text-muted" title={`CIREN Catastro Frutícola ${farm.ciren.sourceLayer}`}>
                  <Database size={12} />
                  CIREN {farm.ciren.objectId}
                </span>
              )}
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
          <Field label="Farm name" error={nameEmpty ? 'Give this farm a name.' : undefined} hint={duplicate ? 'Another farm already uses this name.' : undefined}>
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
                placeholder="e.g. Requínoa cherries north"
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field
              label="Crop"
              hint={farm.ciren ? `CIREN species: ${titleCase(farm.ciren.especie)}.` : undefined}
            >
              {(id) => <Select id={id} options={CROP_OPTIONS} value={farm.crop} onChange={(e) => onUpdate(farm.id, { crop: e.target.value as Farm['crop'] })} />}
            </Field>
            <Field label="Planting year" hint="Optional. Young orchards are more sensitive.">
              {(id) => (
                <CommitNumberInput
                  id={id}
                  value={farm.plantingYear ?? null}
                  min={years.min}
                  max={years.max}
                  step={1}
                  allowEmpty
                  placeholder="e.g. 2018"
                  onCommit={(v) => onUpdate(farm.id, { plantingYear: v === null ? null : Math.round(v) })}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Covers or nets</span>
            <Segmented<TriState>
              ariaLabel="Covers or nets"
              size="sm"
              value={toTri(farm.covered)}
              onChange={(t) => onSetFlag(farm.id, 'covered', fromTri(t))}
              options={[
                { value: 'unset', label: `Not declared (${coveredDefault ? 'covered' : 'open'})`, title: 'Use the crop template default' },
                { value: 'yes', label: 'Covered or netted' },
                { value: 'no', label: 'Open' },
              ]}
            />
            <p className={clsx('text-xs', hint && toTri(farm.covered) === 'unset' && template?.coverLikelihood === 'often' ? 'text-warn' : 'text-muted')}>
              {hint ?? 'Under covers, satellite vegetation indices read the cover, not the trees.'}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Irrigation</span>
            <Segmented<TriState>
              ariaLabel="Irrigation"
              size="sm"
              value={toTri(farm.irrigatedDeclared)}
              onChange={(t) => onSetFlag(farm.id, 'irrigatedDeclared', fromTri(t))}
              options={[
                { value: 'unset', label: 'Not declared', title: 'Inferred from CIREN irrigation maps and the dry-season signal' },
                { value: 'yes', label: 'Irrigated' },
                { value: 'no', label: 'Rain-fed' },
              ]}
            />
            <p className="text-xs text-muted">Not declared: the service infers it from CIREN irrigation maps and how green the orchard stays in the dry season.</p>
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
          {farm.ciren && shapeEditing && (
            <p className="text-xs text-warn">This boundary comes from the CIREN cadastre. Editing it keeps the CIREN reference for peer comparison.</p>
          )}
        </div>
      )}
    </li>
  );
}
