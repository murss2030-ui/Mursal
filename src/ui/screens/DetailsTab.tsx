import { useState } from 'react';
import type { Errors } from '../../domain/entries';
import { parseDecimal } from '../../domain/numbers';
import type { Case, CaseStatus } from '../../domain/types';
import { ValidationError, type CasePatch } from '../../domain/validation';
import { Term, useI18n } from '../../i18n/i18n';
import { Banner, Button, Card, Num, RadioGroup, SelectField, TextAreaField, TextField, useErrorText } from '../components/ui';
import { useIdentifiers, useRotations } from '../data';
import { useSession } from '../session-context';
import { rotationName } from './Home';

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-medium text-slate-900">{children}</span>
    </div>
  );
}

function DemographicsCard({ c }: { c: Case }) {
  const { t, term, date } = useI18n();
  const { store } = useSession();
  const errText = useErrorText();
  const rotations = useRotations();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const rots = rotations.status === 'ready' ? rotations.data : [];
  const rot = rots.find((r) => r.id === c.rotationId);

  const start = () => {
    setV({
      age: String(c.demographics.ageYears),
      sex: c.demographics.sex,
      height: c.demographics.heightCm !== undefined ? String(c.demographics.heightCm) : '',
      ward: c.ward ?? '',
      admission: c.admissionDay0,
      rotationId: c.rotationId,
      reason: '',
    });
    setErrors({});
    setEditing(true);
  };

  const save = async () => {
    const e: Errors = {};
    const age = parseDecimal(v.age ?? '');
    if (!age.ok) e.ageYears = age.reason === 'comma' ? 'comma' : age.reason === 'empty' ? 'required' : 'number';
    let height: number | null = null;
    if ((v.height ?? '').trim() !== '') {
      const h = parseDecimal(v.height!);
      if (!h.ok) e.heightCm = h.reason === 'comma' ? 'comma' : 'number';
      else height = h.value;
    }
    if (!(v.reason ?? '').trim()) e.changeReason = 'required';
    setErrors(e);
    if (Object.keys(e).length) return;
    const patch: CasePatch = {
      ageYears: age.ok ? age.value : undefined,
      sex: v.sex as 'M' | 'F',
      heightCm: height,
      ward: (v.ward ?? '').trim() || null,
      admissionDay0: v.admission,
      rotationId: v.rotationId,
    };
    try {
      await store.updateCase(c.id, patch, v.reason ?? '');
      setEditing(false);
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors);
      else setFailure(t('err.generic', { message: (err as Error).message }));
    }
  };

  if (editing) {
    return (
      <Card title={t('details.demographics')}>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate-600">
            <Term id={c.kind === 'clinical' ? 'clinical_case' : 'teaching_case'} /> — {t('details.kindImmutable')}
          </p>
          <TextField label={t('newCase.age')} name="age" inputMode="decimal" value={v.age ?? ''} onChange={(x) => setV({ ...v, age: x })} error={errText(errors.ageYears)} />
          <RadioGroup
            name="sex"
            label={t('newCase.sex')}
            value={v.sex ?? ''}
            onChange={(x) => setV({ ...v, sex: x })}
            options={[
              { value: 'M', label: t('sex.M') },
              { value: 'F', label: t('sex.F') },
            ]}
          />
          <TextField label={t('newCase.height')} name="height" optional inputMode="decimal" value={v.height ?? ''} onChange={(x) => setV({ ...v, height: x })} error={errText(errors.heightCm)} />
          <TextField label={t('newCase.ward')} name="ward" optional value={v.ward ?? ''} onChange={(x) => setV({ ...v, ward: x })} />
          <TextField
            label={t('newCase.admission')}
            name="admission"
            type="date"
            value={v.admission ?? ''}
            onChange={(x) => setV({ ...v, admission: x })}
            hint={t('details.admissionChange')}
            error={errText(errors.admissionDay0)}
          />
          <SelectField
            label={t('newCase.rotation')}
            name="rotation"
            value={v.rotationId ?? ''}
            onChange={(x) => setV({ ...v, rotationId: x })}
            options={rots.map((r) => ({ value: r.id, label: `${rotationName(r, term)} (${r.startDate} – ${r.endDate})` }))}
            error={errText(errors.rotationId)}
          />
          <TextAreaField label={t('common.reason')} name="reason" hint={t('common.reasonHint')} value={v.reason ?? ''} onChange={(x) => setV({ ...v, reason: x })} error={errText(errors.changeReason)} />
          {failure && <Banner tone="danger">{failure}</Banner>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={save}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={t('details.demographics')}
      actions={
        c.status !== 'archived' ? (
          <Button variant="ghost" icon="pencil" onClick={start}>
            {t('common.edit')}
          </Button>
        ) : undefined
      }
    >
      <Row label={t('newCase.age')}>{c.demographics.ageYears}</Row>
      <Row label={t('newCase.sex')}>{t(`sex.${c.demographics.sex}`)}</Row>
      <Row label={t('newCase.height')}>{c.demographics.heightCm ?? t('details.notRecorded')}</Row>
      <Row label={t('newCase.ward')}>{c.ward ?? t('details.notRecorded')}</Row>
      <Row label={t('newCase.admission')}>
        <Num>{date(c.admissionDay0)}</Num>
      </Row>
      <Row label={t('details.rotation')}>{rot ? rotationName(rot, term) : '—'}</Row>
      {c.syntheticDataAttestedAt && <p className="mt-2 text-xs text-slate-600">{t('details.attested', { when: date(c.syntheticDataAttestedAt.slice(0, 10)) })}</p>}
    </Card>
  );
}

function StatusCard({ c }: { c: Case }) {
  const { t, date } = useI18n();
  const { store } = useSession();
  const errText = useErrorText();
  const [action, setAction] = useState<CaseStatus | null>(null);
  const [reason, setReason] = useState('');
  const [discharge, setDischarge] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const run = async () => {
    const e: Errors = {};
    if (!reason.trim()) e.changeReason = 'required';
    if (action === 'discharged' && !discharge) e.dischargeDate = 'required';
    setErrors(e);
    if (Object.keys(e).length || !action) return;
    try {
      await store.updateCase(c.id, { status: action, ...(action === 'discharged' ? { dischargeDate: discharge } : {}) }, reason);
      setAction(null);
      setReason('');
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors);
    }
  };

  const actions: { to: CaseStatus; key: 'details.discharge' | 'details.archive' | 'details.reactivate' }[] =
    c.status === 'active'
      ? [
          { to: 'discharged', key: 'details.discharge' },
          { to: 'archived', key: 'details.archive' },
        ]
      : c.status === 'discharged'
        ? [
            { to: 'archived', key: 'details.archive' },
            { to: 'active', key: 'details.reactivate' },
          ]
        : [{ to: 'active', key: 'details.reactivate' }];

  return (
    <Card title={t('details.status')}>
      <p className="mb-3 text-sm">
        {t(`case.status.${c.status}`)}
        {c.status === 'discharged' && c.dischargeDate && (
          <>
            {' '}
            · <Num>{date(c.dischargeDate)}</Num>
          </>
        )}
      </p>
      {action ? (
        <div className="flex flex-col gap-3">
          {action === 'discharged' && (
            <TextField label={t('details.dischargeDate')} name="dischargeDate" type="date" value={discharge} onChange={setDischarge} error={errText(errors.dischargeDate)} />
          )}
          <TextAreaField label={t('common.reason')} name="statusReason" hint={t('common.reasonHint')} value={reason} onChange={setReason} error={errText(errors.changeReason)} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={run}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setAction(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.to} onClick={() => setAction(a.to)}>
              {t(a.key)}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function IdentifiersCard({ c }: { c: Case }) {
  const { t } = useI18n();
  const { store } = useSession();
  const errText = useErrorText();
  const ids = useIdentifiers(c.id);
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const current = ids.status === 'ready' ? ids.data : undefined;

  const start = () => {
    setV({
      patientName: current?.patientName ?? '',
      mrn: current?.mrn ?? '',
      roomBed: current?.roomBed ?? '',
      consultantName: current?.consultantName ?? '',
      reason: '',
    });
    setErrors({});
    setEditing(true);
  };
  const save = async () => {
    try {
      await store.setIdentifiers(c.id, v, v.reason ?? '');
      setEditing(false);
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors);
    }
  };

  const fields: { key: 'patientName' | 'mrn' | 'roomBed' | 'consultantName'; label: string }[] = [
    { key: 'patientName', label: t('id.patientName') },
    { key: 'mrn', label: t('id.mrn') },
    { key: 'roomBed', label: t('id.roomBed') },
    { key: 'consultantName', label: t('id.consultant') },
  ];

  return (
    <Card
      title={t('details.identifiers')}
      actions={
        !editing && (
          <div className="flex gap-1">
            <Button variant="ghost" icon={shown ? 'eye-off' : 'eye'} onClick={() => setShown((s) => !s)}>
              {shown ? t('common.hide') : t('common.show')}
            </Button>
            {c.status !== 'archived' && (
              <Button variant="ghost" icon="pencil" onClick={start}>
                {t('common.edit')}
              </Button>
            )}
          </div>
        )
      }
    >
      <p className="mb-2 text-xs text-slate-600">{t('newCase.identifiersHelp')}</p>
      {editing ? (
        <div className="flex flex-col gap-4">
          {fields.map((f) => (
            <TextField key={f.key} label={f.label} name={f.key} optional value={v[f.key] ?? ''} onChange={(x) => setV({ ...v, [f.key]: x })} />
          ))}
          {current && (
            <TextAreaField label={t('common.reason')} name="idReason" hint={t('common.reasonHint')} value={v.reason ?? ''} onChange={(x) => setV({ ...v, reason: x })} error={errText(errors.changeReason)} />
          )}
          <div className="flex gap-2">
            <Button variant="primary" onClick={save}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : shown ? (
        fields.map((f) => (
          <Row key={f.key} label={f.label}>
            <span dir="auto">{current?.[f.key] ?? t('details.notRecorded')}</span>
          </Row>
        ))
      ) : (
        <p className="text-sm text-slate-700">{t('details.identifiersHidden')}</p>
      )}
    </Card>
  );
}

export function DetailsTab({ c, versions }: { c: Case; versions: Case[] }) {
  const { t, when } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <DemographicsCard c={c} />
      <StatusCard c={c} />
      {c.kind === 'clinical' && <IdentifiersCard c={c} />}
      <Card title={t('details.history')}>
        <ol className="flex flex-col gap-2" data-testid="case-versions">
          {[...versions].reverse().map((v) => (
            <li key={v.version} className="text-sm">
              <span className="font-medium">{t('details.versionLine', { n: v.version, when: when(v.versionCreatedAt) })}</span>
              {v.changeReason && <span className="text-slate-700"> — {v.changeReason}</span>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
