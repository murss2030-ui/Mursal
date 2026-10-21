/**
 * M5: the verifier's verdict on one statement, wherever it is shown — a
 * draft's reason, note or claim, a Problem Card's claim. Supported shows the
 * literal quote; partly supported marks the words its source does not state;
 * contradicted shows the quote that says otherwise; not checked says why.
 */
import { useState } from 'react';
import { AiError } from '../../ai/client';
import type { ClaimVerification } from '../../domain/verdicts';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';

const TONE: Record<ClaimVerification['verdict'], string> = {
  supported: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  partial: 'border-amber-400 bg-amber-50 text-amber-950',
  unsupported: 'border-red-300 bg-red-50 text-red-900',
  contradicted: 'border-red-400 bg-red-50 text-red-950',
  not_checked: 'border-slate-300 bg-slate-50 text-slate-700',
};

/** One statement's verdict. `checkable` false: a statement with no source the app holds (general knowledge), which no check can pass. */
export function VerdictLine({ v, checkable = true }: { v?: ClaimVerification; checkable?: boolean }) {
  const { t, when } = useI18n();
  if (!checkable) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-900" data-testid="verdict" data-verdict="no_source">
        <Icon name="alert-triangle" className="mt-px h-3.5 w-3.5 shrink-0" />
        {t('verdict.noSource')}
      </p>
    );
  }
  if (!v) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-slate-700" data-testid="verdict" data-verdict="none">
        <Icon name="clock" className="mt-px h-3.5 w-3.5 shrink-0" />
        {t('verdict.none')}
      </p>
    );
  }
  return (
    <div className={`flex flex-col gap-1 rounded-lg border px-2 py-1.5 text-xs ${TONE[v.verdict]}`} data-testid="verdict" data-verdict={v.verdict}>
      <p className="flex flex-wrap items-center gap-x-2 font-semibold">
        <Icon name={v.verdict === 'supported' ? 'check-circle' : v.verdict === 'not_checked' ? 'clock' : 'alert-triangle'} className="h-3.5 w-3.5 shrink-0" />
        {t(`verdict.${v.verdict}` as MsgKey)}
      </p>
      {v.verdict === 'not_checked' && v.failure && <p>{t('verdict.failure', { reason: t(`ai.err.${v.failure}` as MsgKey) === `ai.err.${v.failure}` ? v.failure : t(`ai.err.${v.failure}` as MsgKey) })}</p>}
      {v.quotes.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="verdict-quotes">
          {v.quotes.map((q, i) => (
            <li key={i} dir="auto">
              <q className="font-mono text-[11px]">{q.text}</q> <span className="opacity-80">— {q.source}</span>
            </li>
          ))}
        </ul>
      )}
      {v.unsupportedParts.length > 0 && (
        <p dir="auto" data-testid="verdict-parts">
          <span className="font-medium">{t('verdict.notInSource')} </span>
          {v.unsupportedParts.map((p, i) => (
            <mark key={i} className="me-1 rounded bg-amber-200/70 px-0.5 text-inherit">
              {p}
            </mark>
          ))}
        </p>
      )}
      <p className="opacity-75">{t('verdict.by', { model: v.model ?? '—', when: when(v.at) })}</p>
    </div>
  );
}

/** "Check with the verifier": runs a check and says what came of it, or why it could not run. */
export function CheckButton({ label, run, testId }: { label: string; run: () => Promise<{ checked: number; failures: unknown[] }>; testId: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string }>();
  const go = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await run();
      setMsg({ tone: r.failures.length ? 'err' : 'ok', text: r.checked === 0 ? t('verdict.nothingToCheck') : r.failures.length ? t('verdict.someNotChecked') : t('verdict.checked', { n: r.checked }) });
    } catch (e) {
      const text = e instanceof AiError ? (t(`ai.err.${e.code}` as MsgKey) === `ai.err.${e.code}` ? e.message : t(`ai.err.${e.code}` as MsgKey)) : (e as Error).message;
      setMsg({ tone: 'err', text });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button icon="shield" disabled={busy} onClick={() => void go()} data-testid={testId}>
        {busy ? t('verdict.checking') : label}
      </Button>
      {msg && (
        <p className={`text-xs ${msg.tone === 'ok' ? 'text-emerald-900' : 'text-red-800'}`} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}
