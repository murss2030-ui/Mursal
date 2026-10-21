import { useEffect, useMemo, useState } from 'react';
import { MODEL_TASKS, type ModelTask, type RelayStatus } from '../../ai/protocol';
import type { AiSettings } from '../../ai/settings';
import type { AuditEvent } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { useAiStatus, type AiStatusState } from '../ai-status';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/Progress';
import { Banner, Button, Card, Num, PageTitle, SelectField, TextField, useErrorText } from '../components/ui';
import { useAudit } from '../data';
import { useSession } from '../session-context';

const OTHER = '__other__';
const usd = (n: number) => `US$${n.toFixed(n < 1 ? 3 : 2)}`;

function StatusCard({ state, onRefresh }: { state: AiStatusState; onRefresh: () => void }) {
  const { t } = useI18n();
  if (state.kind === 'loading') return <Card title={t('ai.status')}>{t('common.loading')}</Card>;
  if (state.kind === 'error') {
    const key = `ai.err.${state.error.code}` as MsgKey;
    return (
      <Card title={t('ai.status')} actions={<Button icon="history" onClick={onRefresh}>{t('ai.checkAgain')}</Button>}>
        <div className="flex flex-col gap-2" data-testid="ai-status" data-state={state.error.code}>
          <p className="flex items-center gap-2 font-medium text-slate-900">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            {t('ai.notAvailable')}
          </p>
          <p className="text-sm text-slate-700">{t(key) !== key ? t(key) : state.error.message}</p>
        </div>
      </Card>
    );
  }
  const s = state.status;
  const pct = s.budget.budgetUsd > 0 ? s.budget.spentUsd / s.budget.budgetUsd : 0;
  return (
    <Card title={t('ai.status')} actions={<Button icon="history" onClick={onRefresh}>{t('ai.checkAgain')}</Button>}>
      <div className="flex flex-col gap-3" data-testid="ai-status" data-state={s.configured ? 'ready' : 'not_configured'}>
        <p className="flex items-center gap-2 font-medium text-slate-900">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${s.configured ? 'bg-emerald-500' : 'bg-saffron-500'}`} />
          {s.configured ? t('ai.connected') : t('ai.err.not_configured')}
        </p>
        <div className={`rounded-xl px-3 py-2 text-sm ${s.keyClass === 'paid' ? 'bg-emerald-50 text-emerald-900' : 'bg-saffron-50 text-saffron-900'}`} data-testid="ai-key-class">
          <strong>{s.keyClass === 'paid' ? t('ai.keyPaid') : t('ai.keyFree')}</strong> — {s.keyClass === 'paid' ? t('ai.keyPaidHelp') : t('ai.keyFreeHelp')}
        </div>
        <div className="flex flex-col gap-1.5" data-testid="ai-budget">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-slate-800">{t('ai.budget', { month: s.budget.month })}</span>
            <Num>
              <span className="tabular text-slate-900">
                {usd(s.budget.spentUsd)} / {usd(s.budget.budgetUsd)}
              </span>
            </Num>
          </div>
          <ProgressBar value={Math.round(pct * 1000)} total={1000} barClass={pct > 0.9 ? 'bg-rose-600' : pct > 0.6 ? 'bg-saffron-500' : 'bg-teal-700'} label={t('ai.budget', { month: s.budget.month })} />
          <p className="text-xs text-slate-600">
            {t('ai.remaining', { usd: usd(Math.max(0, s.budget.budgetUsd - s.budget.spentUsd)) })} · {t('ai.calls', { n: s.budget.calls })} ·{' '}
            {t('ai.limits', { m: s.limits.perMinute, d: s.limits.perDay })}
          </p>
          {Object.keys(s.budget.byTask).length > 0 && (
            <ul className="flex flex-wrap gap-1.5 text-xs">
              {MODEL_TASKS.filter((k) => s.budget.byTask[k] !== undefined).map((k) => (
                <li key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                  {t(`ai.task.${k}`)}: <Num>{usd(s.budget.byTask[k] ?? 0)}</Num>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function modelOptions(status: RelayStatus | undefined, current: string | undefined) {
  const opts = (status?.models ?? []).map((m) => ({ value: m.id, label: `${m.id} · US$${m.inputPerM}/${m.outputPerM} per 1M` }));
  if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: current });
  return opts;
}

function SettingsForm({ state, onSaved }: { state: AiStatusState; onSaved: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const { store } = useSession();
  const settings: AiSettings | undefined = state.kind === 'loading' ? undefined : state.settings;
  const status = state.kind === 'ready' ? state.status : undefined;
  const [code, setCode] = useState('');
  const [models, setModels] = useState<Partial<Record<ModelTask, string>>>({});
  const [typed, setTyped] = useState<Partial<Record<ModelTask, string>>>({});
  const [fallbacks, setFallbacks] = useState<Partial<Record<ModelTask, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!settings) return;
    setCode(settings.accessCode ?? '');
    // The operator's suggestions fill empty choices; nothing is used until the trainee saves.
    setModels({ ...(status?.suggested ?? {}), ...settings.models });
    setFallbacks(Object.fromEntries(Object.entries(settings.fallbacks ?? {}).map(([k, v]) => [k, (v ?? []).join(', ')])));
  }, [settings?.installId, status?.configured]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!settings) return null;
  const listOnly = !status?.modelPattern;
  const chosen = (k: ModelTask) => (models[k] === OTHER ? typed[k] : models[k])?.trim();

  const save = async () => {
    setErrors({});
    const picked: Partial<Record<ModelTask, string>> = {};
    for (const k of MODEL_TASKS) picked[k] = chosen(k);
    try {
      await store.updateAiSettings({ accessCode: code, models: picked, fallbacks });
      setSaved(true);
      onSaved();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.errors);
      else throw e;
    }
  };

  return (
    <Card title={t('ai.yourSettings')}>
      <div className="flex flex-col gap-4">
        <TextField
          label={t('ai.accessCode')}
          hint={t('ai.accessCodeHelp')}
          optional
          type="password"
          name="accessCode"
          value={code}
          onChange={(x) => {
            setCode(x);
            setSaved(false);
          }}
          error={errText(errors.accessCode as never)}
        />
        {MODEL_TASKS.map((k) => {
          const opts = modelOptions(status, models[k] !== OTHER ? models[k] : undefined);
          return (
            <div key={k} className="flex flex-col gap-2">
              {opts.length > 0 || !listOnly ? (
                <SelectField
                  label={t(`ai.model.${k}`)}
                  hint={t(`ai.modelHelp.${k}`)}
                  name={`model_${k}`}
                  optional={k === 'verify' || k === 'embed' || k === 'research'}
                  value={models[k] ?? ''}
                  onChange={(x) => {
                    setModels((m) => ({ ...m, [k]: x }));
                    setSaved(false);
                  }}
                  options={[...opts, ...(listOnly ? [] : [{ value: OTHER, label: t('ai.otherModel') }])]}
                  error={errText(errors[`model_${k}`] as never)}
                />
              ) : (
                <TextField
                  label={t(`ai.model.${k}`)}
                  hint={t(`ai.modelHelp.${k}`)}
                  name={`model_${k}`}
                  optional={k === 'verify' || k === 'embed' || k === 'research'}
                  dir="ltr"
                  value={models[k] ?? ''}
                  onChange={(x) => {
                    setModels((m) => ({ ...m, [k]: x }));
                    setSaved(false);
                  }}
                  error={errText(errors[`model_${k}`] as never)}
                />
              )}
              {models[k] === OTHER && (
                <TextField
                  label={t('ai.otherModelId')}
                  hint={t('ai.otherModelHelp', { pattern: status?.modelPattern ?? '' })}
                  name={`model_${k}_other`}
                  dir="ltr"
                  value={typed[k] ?? ''}
                  onChange={(x) => setTyped((m) => ({ ...m, [k]: x }))}
                />
              )}
              {/* M5: a second reading by the model that drafted is not independent (Section 12, check 4). */}
              {k === 'verify' && chosen('verify') && chosen('verify') === chosen('analyse') && (
                <p className="text-xs text-amber-900" data-testid="verify-same-model">
                  {t('ai.verifySameModel')}
                </p>
              )}
              {k === 'verify' && (
                <TextField
                  label={t('ai.fallbacks')}
                  hint={t('ai.fallbacksHelp')}
                  optional
                  name={`fallback_${k}`}
                  dir="ltr"
                  value={fallbacks[k] ?? ''}
                  onChange={(x) => {
                    setFallbacks((m) => ({ ...m, [k]: x }));
                    setSaved(false);
                  }}
                  error={errText(errors[`fallback_${k}`] as never)}
                />
              )}
            </div>
          );
        })}
        {saved && (
          <Banner tone="success" role="status">
            {t('set.saved')}
          </Banner>
        )}
        <Button variant="primary" icon="check" onClick={save}>
          {t('common.save')}
        </Button>
        <p className="text-xs text-slate-600">
          {t('ai.installId')}: <span className="font-mono" dir="ltr">{settings.installId}</span>
        </p>
      </div>
    </Card>
  );
}

function DeviceUsage() {
  const { t } = useI18n();
  const audit = useAudit();
  const month = new Date().toISOString().slice(0, 7);
  const rows = useMemo(() => {
    const evs: AuditEvent[] = audit.status === 'ready' ? audit.data.filter((e) => e.entity === 'model_call' && e.at.startsWith(month)) : [];
    const by = new Map<string, { calls: number; cost: number; tokens: number }>();
    for (const e of evs) {
      const d = e.diff as { task: string; costUsd: number; inputTokens: number; outputTokens: number };
      const cur = by.get(d.task) ?? { calls: 0, cost: 0, tokens: 0 };
      by.set(d.task, { calls: cur.calls + 1, cost: cur.cost + (d.costUsd ?? 0), tokens: cur.tokens + (d.inputTokens ?? 0) + (d.outputTokens ?? 0) });
    }
    return [...by];
  }, [audit, month]);
  return (
    <Card title={t('ai.deviceUsage', { month })}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">{t('ai.noCalls')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm" data-testid="ai-device-usage">
          {rows.map(([task, r]) => (
            <li key={task} className="flex items-center justify-between py-2">
              <span>{t(`ai.task.${task as ModelTask}`)}</span>
              <Num>
                <span className="tabular text-slate-700">
                  {t('ai.calls', { n: r.calls })} · {r.tokens.toLocaleString('en')} tokens · {usd(r.cost)}
                </span>
              </Num>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AiSettingsScreen() {
  const { t } = useI18n();
  const { state, refresh } = useAiStatus();
  return (
    <div className="flex flex-col gap-4" data-testid="ai-settings">
      <PageTitle back="#/settings">{t('ai.title')}</PageTitle>
      <Banner tone="info">
        <span className="flex flex-col gap-1">
          <span className="flex items-center gap-2 font-medium">
            <Icon name="shield" className="h-4 w-4" />
            {t('ai.whatIsSent')}
          </span>
          <span>{t('ai.whatIsSentText')}</span>
        </span>
      </Banner>
      <StatusCard state={state} onRefresh={refresh} />
      <SettingsForm state={state} onSaved={refresh} />
      <DeviceUsage />
    </div>
  );
}
