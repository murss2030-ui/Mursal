/**
 * Form and layout primitives. Mobile-first: touch targets are at least 44px,
 * every input has a visible label, and errors are announced next to their field.
 */
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { FieldError } from '../../domain/entries';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-800 text-white hover:bg-teal-900 disabled:bg-slate-400',
  secondary: 'bg-white text-teal-900 border border-teal-800 hover:bg-teal-50 disabled:text-slate-400 disabled:border-slate-300',
  ghost: 'bg-transparent text-teal-900 hover:bg-teal-50 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400',
};

export function Button({
  variant = 'secondary',
  icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'secondary',
  icon,
  children,
  className = '',
}: {
  href: string;
  variant?: Variant;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-medium no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${VARIANTS[variant]} ${className}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </a>
  );
}

export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'info' | 'warning' | 'danger' | 'success';
const TONES: Record<Tone, { box: string; icon: IconName }> = {
  info: { box: 'border-sky-300 bg-sky-50 text-sky-950', icon: 'info' },
  warning: { box: 'border-amber-400 bg-amber-50 text-amber-950', icon: 'alert-triangle' },
  danger: { box: 'border-red-400 bg-red-50 text-red-950', icon: 'alert-triangle' },
  success: { box: 'border-emerald-400 bg-emerald-50 text-emerald-950', icon: 'check-circle' },
};

export function Banner({ tone = 'info', children, className = '', role }: { tone?: Tone; children: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={`flex gap-2 rounded-lg border p-3 text-sm ${TONES[tone].box} ${className}`}>
      <Icon name={TONES[tone].icon} className="mt-0.5 h-5 w-5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function useErrorText() {
  const { t } = useI18n();
  return (e: FieldError | undefined) => (e ? t(`err.${e}` as MsgKey) : undefined);
}

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
}

export function FieldShell({ label, hint, error, optional, children }: FieldShellProps) {
  const id = useId();
  const { t } = useI18n();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
        {optional && <span className="ms-1 font-normal text-slate-500">({t('common.optional')})</span>}
      </label>
      {children({ id, describedBy })}
      {hint && (
        <p id={hintId} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT =
  'min-h-touch w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 aria-[invalid=true]:border-red-600';

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  optional,
  inputMode,
  type = 'text',
  autoComplete = 'off',
  dir,
  name,
  placeholder,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
  type?: 'text' | 'password' | 'date' | 'time';
  autoComplete?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  name?: string;
  placeholder?: string;
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy }) => (
        <input
          id={id}
          name={name}
          type={type}
          inputMode={inputMode}
          dir={dir ?? (inputMode === 'decimal' || inputMode === 'numeric' || type !== 'text' ? 'ltr' : 'auto')}
          className={INPUT}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  error,
  hint,
  optional,
  rows = 3,
  name,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  rows?: number;
  name?: string;
}) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          name={name}
          rows={rows}
          dir="auto"
          className={INPUT}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  optional,
  name,
  groups,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options?: Option[];
  groups?: { label: string; options: Option[] }[];
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  name?: string;
}) {
  const { t } = useI18n();
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy }) => (
        <select
          id={id}
          name={name}
          className={INPUT}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('common.select')}</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {groups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/** Radio buttons as large tappable rows. Nothing is pre-selected unless the value says so. */
export function RadioGroup({
  label,
  value,
  onChange,
  options,
  error,
  name,
  hint,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: (Option & { help?: ReactNode })[];
  error?: string;
  name: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex min-h-touch cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${value === o.value ? 'border-teal-700 bg-teal-50' : 'border-slate-300 bg-white'}`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-1 h-5 w-5 accent-teal-700"
          />
          <span className="flex flex-col">
            <span className="text-base text-slate-900">{o.label}</span>
            {o.help && <span className="text-xs text-slate-600">{o.help}</span>}
          </span>
        </label>
      ))}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  error,
  hint,
  name,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  hint?: ReactNode;
  name?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-touch cursor-pointer items-start gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-teal-700"
          aria-invalid={error ? true : undefined}
        />
        <span className="text-sm text-slate-900">{label}</span>
      </label>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** A numeric value with its unit, isolated so right-to-left text never reorders it. */
export function Num({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="whitespace-nowrap">
      {children}
    </bdi>
  );
}

export function DayLabel({ day }: { day: number }) {
  const { t } = useI18n();
  return <Num>{t('common.day', { n: day < 0 ? `−${Math.abs(day)}` : day })}</Num>;
}

export function PageTitle({ children, back }: { children: ReactNode; back?: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex items-center gap-2">
      {back && (
        <a href={back} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-teal-900 hover:bg-teal-50" aria-label={t('common.back')}>
          <Icon name="chevron-back" className="h-6 w-6" />
        </a>
      )}
      <h1 className="text-2xl font-semibold text-slate-900">{children}</h1>
    </div>
  );
}

export function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'teal' | 'amber' | 'red' | 'violet' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-800 border-slate-300',
    teal: 'bg-teal-50 text-teal-900 border-teal-300',
    amber: 'bg-amber-50 text-amber-900 border-amber-400',
    red: 'bg-red-50 text-red-800 border-red-300',
    violet: 'bg-violet-50 text-violet-900 border-violet-300',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
