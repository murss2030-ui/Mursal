import { useEffect, useState } from 'react';
import type { Errors } from '../../domain/entries';
import { currentRotation } from '../../domain/rotation';
import { COMPETENCY_AREAS, DEPARTMENTS, type CompetencyArea, type DepartmentId } from '../../domain/types';
import { ValidationError, validateRotation, type RotationInput } from '../../domain/validation';
import { Term, useI18n } from '../../i18n/i18n';
import type { TermId } from '../../i18n/terms';
import { Banner, Button, Card, CheckboxField, Chip, LinkButton, Num, PageTitle, SelectField, TextAreaField, TextField, useErrorText } from '../components/ui';
import { useRotations, useRotationVersions } from '../data';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { rotationName } from './Home';

export function Rotations() {
  const { t, term, date } = useI18n();
  const { store } = useSession();
  const rotations = useRotations();
  const list = rotations.status === 'ready' ? [...rotations.data].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)) : [];
  const cur = rotations.status === 'ready' ? currentRotation(rotations.data, store.today()) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <PageTitle back="#/more">{t('rot.title')}</PageTitle>
        <LinkButton href="#/rotations/new" variant="primary" icon="plus">
          {t('rot.new')}
        </LinkButton>
      </div>
      {rotations.status === 'ready' && list.length === 0 && <p className="text-slate-600">{t('rot.empty')}</p>}
      {list.map((r) => (
        <Card
          key={r.id}
          title={rotationName(r, term)}
          actions={
            <LinkButton href={`#/rotations/${r.id}/edit`} variant="ghost" icon="pencil">
              {t('common.edit')}
            </LinkButton>
          }
        >
          <p className="text-sm text-slate-700">
            <Num>
              {date(r.startDate)} – {date(r.endDate)}
            </Num>{' '}
            {cur?.id === r.id && <Chip tone="teal">{t('rot.current')}</Chip>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {r.competencies.map((c) => (
              <Chip key={c}>
                <Term id={`comp.${c}` as TermId} />
              </Chip>
            ))}
          </div>
          {r.goals && (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-800" dir="auto">
              {r.goals}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

export function RotationEditor({ rotationId }: { rotationId?: string }) {
  const { t, term } = useI18n();
  const { store } = useSession();
  const errText = useErrorText();
  const versions = useRotationVersions(rotationId ?? '');
  const existing = rotationId && versions.status === 'ready' ? versions.data.at(-1) : undefined;
  const [v, setV] = useState<RotationInput & { reason: string }>({
    department: '' as DepartmentId,
    departmentOther: '',
    startDate: '',
    endDate: '',
    competencies: [],
    goals: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (existing) {
      setV({
        department: existing.department,
        departmentOther: existing.departmentOther ?? '',
        startDate: existing.startDate,
        endDate: existing.endDate,
        competencies: existing.competencies,
        goals: existing.goals ?? '',
        reason: '',
      });
    }
  }, [existing?.id, existing?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rotationId && versions.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;

  const toggle = (c: CompetencyArea, on: boolean) =>
    setV({ ...v, competencies: on ? [...v.competencies, c] : v.competencies.filter((x) => x !== c) });

  const save = async () => {
    const errs = validateRotation(v);
    if (rotationId && !v.reason.trim()) errs.changeReason = 'required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const { reason, ...input } = v;
      if (rotationId) await store.updateRotation(rotationId, input, reason);
      else await store.createRotation(input);
      navigate('/rotations');
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.errors);
      else setFailure(t('err.generic', { message: (e as Error).message }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/rotations">{rotationId ? t('rot.edit') : t('rot.new')}</PageTitle>
      <Card>
        <div className="flex flex-col gap-4">
          <SelectField
            label={t('rot.department')}
            name="department"
            value={v.department}
            onChange={(x) => setV({ ...v, department: x as DepartmentId })}
            options={DEPARTMENTS.map((d) => ({ value: d, label: term(`dept.${d}` as TermId) }))}
            error={errText(errors.department)}
          />
          {v.department === 'other' && (
            <TextField label={t('rot.departmentOther')} name="departmentOther" value={v.departmentOther ?? ''} onChange={(x) => setV({ ...v, departmentOther: x })} error={errText(errors.departmentOther)} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('rot.start')} name="startDate" type="date" value={v.startDate} onChange={(x) => setV({ ...v, startDate: x })} error={errText(errors.startDate)} />
            <TextField label={t('rot.end')} name="endDate" type="date" value={v.endDate} onChange={(x) => setV({ ...v, endDate: x })} error={errText(errors.endDate)} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('rot.competencies')}</legend>
            <p className="text-xs text-slate-600">{t('rot.competenciesHelp')}</p>
            {COMPETENCY_AREAS.map((c) => (
              <CheckboxField key={c} name={`comp-${c}`} label={<Term id={`comp.${c}` as TermId} />} checked={v.competencies.includes(c)} onChange={(on) => toggle(c, on)} />
            ))}
          </fieldset>
          <TextAreaField label={t('rot.goals')} name="goals" optional value={v.goals ?? ''} onChange={(x) => setV({ ...v, goals: x })} />
          {rotationId && (
            <TextAreaField label={t('common.reason')} name="reason" hint={t('common.reasonHint')} value={v.reason} onChange={(x) => setV({ ...v, reason: x })} error={errText(errors.changeReason)} />
          )}
          {failure && <Banner tone="danger">{failure}</Banner>}
          <Button variant="primary" onClick={save}>
            {t('rot.save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
