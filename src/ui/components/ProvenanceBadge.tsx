import { PROVENANCE_VISUALS } from '../../domain/provenance';
import type { ProvenanceState } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { Icon } from './Icon';

/**
 * The visual treatment of a provenance state, rendered directly from the
 * tested specification (domain/provenance.ts): icon + text label + border and
 * fill, never colour alone.
 */
export function ProvenanceBadge({ state, detail }: { state: ProvenanceState; detail?: string }) {
  const v = PROVENANCE_VISUALS[state];
  const { lang } = useI18n();
  return (
    <span
      data-provenance={state}
      title={v.rule}
      className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
      style={{
        color: v.fg,
        backgroundColor: v.bg,
        borderColor: v.borderColor,
        borderStyle: v.borderStyle,
        borderWidth: v.borderWidth,
        fontStyle: v.italic ? 'italic' : 'normal',
      }}
    >
      <Icon name={v.icon} className="h-3.5 w-3.5" />
      <span lang="en" dir="ltr">
        {v.label}
      </span>
      {lang === 'ar' && <span lang="ar">· {v.labelAr}</span>}
      {detail && <span className="font-normal">· {detail}</span>}
    </span>
  );
}
