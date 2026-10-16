import { useState } from 'react';
import { RELEASE_GATE_MET } from '../../config/release';
import type { Errors } from '../../domain/entries';
import { parseDecimal } from '../../domain/numbers';
import { currentRotation } from '../../domain/rotation';
import type { CaseKind, Sex } from '../../domain/types';
import { ValidationError, validateNewCase, type NewCaseInput } from '../../domain/validation';
import { Term, useI18n } from '../../i18n/i18n';
import { Banner, Button, Card, CheckboxField, LinkButton, PageTitle, RadioGroup, SelectField, TextField, useErrorText } from '../components/ui';
import { useRotations } from '../data';
import { usePersistentDraft } from '../hooks';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { rotationName } from './Home';

const EMPTY = {
  kind: '',
  rotationId: '',
  age: '',
  sex: '',
  height: '',
  admission: '',
  ward: '',
  patientName: '',
  mrn: '',
  roomBed: '',
  consultant: '',
  attest: '',
};

export function NewCase() {
  const { t, term } = useI18n();
  const { store } = useSession();
  const errText = useErrorText();
  const rotations = useRotations();
  const draft = usePersistentDraft('case:new', EMPTY);
  const v = draft.values;
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  const rots = rotations.status === 'ready' ? rotations.data : [];
  const current = currentRotation(rots, store.today());
  const rotationId = v.rotationId || current?.id || '';

  if (rotations.status === 'ready' && rots.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle back="#/cases">{t('newCase.title')}</PageTitle>
        <Banner tone="info">{t('newCase.needRotation')}</Banner>
        <LinkButton href="#/rotations/new" variant="primary" icon="plus">
          {t('home.createRotation')}
        </LinkButton>
      </div>
    );
  }

  const submit = async () => {
    const errs: Errors = {};
    const num = (s: string, key: string) => {
      if (s.trim() === '') return undefined;
      const r = parseDecimal(s);
      if (!r.ok) {
        errs[key] = r.reason === 'comma' ? 'comma' : 'number';
        return undefined;
      }
      return r.value;
    };
    const ageYears = num(v.age, 'ageYears');
    const heightCm = num(v.height, 'heightCm');
    const input: Partial<NewCaseInput> = {
      kind: (v.kind || undefined) as CaseKind | undefined,
      rotationId,
      ageYears,
      sex: (v.sex || undefined) as Sex | undefined,
      heightCm,
      admissionDay0: v.admission,
      ward: v.ward,
      syntheticDataAttested: v.attest === 'yes',
      identifiers:
        v.kind === 'clinical'
          ? { patientName: v.patientName, mrn: v.mrn, roomBed: v.roomBed, consultantName: v.consultant }
          : undefined,
    };
    Object.assign(errs, validateNewCase(input, store.today()), errs);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const here = window.location.hash;
    try {
      const c = await store.createCase(input as NewCaseInput);
      await draft.clear();
      // Step 2: the patient file, then "Next" into the Clinical Modules.
      if (window.location.hash === here) navigate(`/cases/${c.id}/intake`);
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.errors);
      else setFailure(t('err.generic', { message: (e as Error).message }));
      setBusy(false);
    }
  };

  if (!draft.ready) return <p className="text-slate-600">{t('common.loading')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/cases">{t('newCase.title')}</PageTitle>
      {draft.restored && <Banner tone="info">{t('ed.restored')}</Banner>}
      <Card>
        <div className="flex flex-col gap-4">
          <RadioGroup
            name="kind"
            label={t('newCase.kind')}
            value={v.kind}
            onChange={(x) => draft.set('kind', x)}
            error={errText(errors.kind)}
            options={[
              { value: 'teaching', label: term('teaching_case'), help: t('newCase.kindTeachingHelp') },
              { value: 'clinical', label: term('clinical_case'), help: t('newCase.kindClinicalHelp') },
            ]}
          />
          <SelectField
            label={t('newCase.rotation')}
            name="rotation"
            value={rotationId}
            onChange={(x) => draft.set('rotationId', x)}
            error={errText(errors.rotationId)}
            options={rots.map((r) => ({ value: r.id, label: `${rotationName(r, term)} (${r.startDate} – ${r.endDate})` }))}
          />
          <TextField label={t('newCase.age')} name="age" inputMode="decimal" value={v.age} onChange={(x) => draft.set('age', x)} error={errText(errors.ageYears)} />
          <RadioGroup
            name="sex"
            label={t('newCase.sex')}
            value={v.sex}
            onChange={(x) => draft.set('sex', x)}
            error={errText(errors.sex)}
            options={[
              { value: 'M', label: t('sex.M') },
              { value: 'F', label: t('sex.F') },
            ]}
          />
          <TextField
            label={t('newCase.height')}
            name="height"
            optional
            inputMode="decimal"
            value={v.height}
            onChange={(x) => draft.set('height', x)}
            error={errText(errors.heightCm)}
          />
          <TextField
            label={t('newCase.admission')}
            name="admission"
            type="date"
            value={v.admission}
            onChange={(x) => draft.set('admission', x)}
            hint={t('newCase.admissionHelp')}
            error={errText(errors.admissionDay0)}
          />
          <TextField label={t('newCase.ward')} name="ward" optional value={v.ward} onChange={(x) => draft.set('ward', x)} error={errText(errors.ward)} />
        </div>
      </Card>

      {v.kind === 'clinical' && (
        <Card title={t('newCase.identifiers')}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-700">{t('newCase.identifiersHelp')}</p>
            <TextField label={t('id.patientName')} name="patientName" optional value={v.patientName} onChange={(x) => draft.set('patientName', x)} />
            <TextField label={t('id.mrn')} name="mrn" optional dir="ltr" value={v.mrn} onChange={(x) => draft.set('mrn', x)} />
            <TextField label={t('id.roomBed')} name="roomBed" optional value={v.roomBed} onChange={(x) => draft.set('roomBed', x)} />
            <TextField label={t('id.consultant')} name="consultant" optional value={v.consultant} onChange={(x) => draft.set('consultant', x)} />
          </div>
        </Card>
      )}

      {!RELEASE_GATE_MET && (
        <CheckboxField
          name="attest"
          label={t('newCase.attest')}
          hint={t('newCase.attestHelp')}
          checked={v.attest === 'yes'}
          onChange={(x) => draft.set('attest', x ? 'yes' : '')}
          error={errText(errors.syntheticDataAttested)}
        />
      )}
      {Object.keys(errors).length > 0 && <Banner tone="danger" role="alert">{t('err.fixFields')}</Banner>}
      {failure && <Banner tone="danger" role="alert">{failure}</Banner>}
      <Button variant="primary" onClick={submit} disabled={busy}>
        {busy ? t('common.saving') : t('newCase.create')}
      </Button>
      <p className="text-xs text-slate-600">
        <Term id="teaching_case" /> / <Term id="clinical_case" />: {t('details.kindImmutable')}
      </p>
    </div>
  );
}
