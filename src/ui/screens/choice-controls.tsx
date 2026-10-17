/** Tappable choice controls for worksheets: large targets, one-handed use, nothing pre-selected. */
import { useId } from 'react';
import type { L } from '../../domain/label';
import { useL } from '../bilingual';

interface Opt {
  value: string;
  label: L;
}

/** Single choice as pills. Tapping the selected pill again clears it. */
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
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
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
              className={`min-h-[40px] rounded-full border px-3 text-start text-sm font-medium disabled:opacity-50 ${on ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'}`}
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

/** Multiple choice as toggle pills; the value is the selected options joined with "|". */
export function MultiPills({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  hint?: string;
  options: readonly Opt[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: string;
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
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {hint && (
        <p id={`${id}-hint`} className="-mt-1 text-xs text-slate-600">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(o.value)}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium disabled:opacity-50 ${on ? 'border-teal-800 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'}`}
            >
              <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${on ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-400'}`}>
                {on ? '✓' : ''}
              </span>
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
