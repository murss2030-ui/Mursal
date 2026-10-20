/** Tappable choice controls for worksheets: large targets, one-handed use, nothing pre-selected. */
import { useId } from 'react';
import type { L } from '../../domain/label';
import { useL } from '../bilingual';

interface Opt {
  value: string;
  label: L;
}

/** Single choice as pills. Tapping the selected pill again clears it. `stacked`: one option per row, for long labels. */
export function ChoicePills({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  disabledValues,
  error,
  testId,
  stacked,
}: {
  label: string;
  hint?: string;
  options: readonly Opt[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Options that cannot be newly chosen (e.g. locked by the Verify gate). */
  disabledValues?: readonly string[];
  error?: string;
  testId?: string;
  stacked?: boolean;
}) {
  const tl = useL();
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} data-testid={testId}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {hint && (
        <p id={`${id}-hint`} className="-mt-1 text-xs text-slate-600">
          {hint}
        </p>
      )}
      <div role="radiogroup" aria-label={label} className={stacked ? 'flex flex-col gap-1.5' : 'flex flex-wrap gap-1.5'}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled || (!on && disabledValues?.includes(o.value))}
              onClick={() => onChange(on ? '' : o.value)}
              className={`min-h-[40px] border px-3 text-start text-sm font-medium disabled:opacity-50 ${stacked ? 'rounded-xl py-2' : 'rounded-full'} ${on ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'}`}
            >
              {tl(o.label)}
            </button>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Multiple choice as toggle pills; the value is the selected options joined
 * with "|". With `groups`, long lists (the 38 PCNE causes) fold by group, a
 * group with a chosen option open.
 */
export function MultiPills({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  error,
  groups,
  testId,
}: {
  label: string;
  hint?: string;
  options: readonly (Opt & { group?: string })[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: string;
  groups?: readonly { id: string; label: L }[];
  testId?: string;
}) {
  const tl = useL();
  const id = useId();
  const selected = new Set(value.split('|').filter(Boolean));
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(options.map((o) => o.value).filter((x) => next.has(x)).join('|'));
  };
  const pills = (list: readonly Opt[]) => (
    <div className="flex flex-wrap gap-1.5">
      {list.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(o.value)}
            className={`inline-flex min-h-[40px] items-center gap-1.5 border px-3 text-start text-sm font-medium disabled:opacity-50 ${groups ? 'rounded-xl py-1.5' : 'rounded-full'} ${on ? 'border-teal-800 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'}`}
          >
            <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-400'}`}>
              {on ? '✓' : ''}
            </span>
            {tl(o.label)}
          </button>
        );
      })}
    </div>
  );
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} data-testid={testId}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {hint && (
        <p id={`${id}-hint`} className="-mt-1 text-xs text-slate-600">
          {hint}
        </p>
      )}
      {groups ? (
        <div className="flex flex-col gap-1">
          {groups.map((g) => {
            const list = options.filter((o) => o.group === g.id);
            const n = list.filter((o) => selected.has(o.value)).length;
            return (
              <details key={g.id} open={n > 0} className="rounded-xl border border-line bg-white/70 px-3" data-group={g.id}>
                <summary className="flex min-h-touch cursor-pointer items-center justify-between gap-2 text-sm font-medium text-slate-800">
                  <span>{tl(g.label)}</span>
                  {n > 0 && <span className="rounded-full bg-teal-800 px-2 text-xs text-white">{n}</span>}
                </summary>
                <div className="pb-3">{pills(list)}</div>
              </details>
            );
          })}
        </div>
      ) : (
        pills(options)
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
