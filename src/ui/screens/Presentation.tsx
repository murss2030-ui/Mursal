/**
 * The monthly presentation (plan M7): choose a rotation and its cases, see
 * what the verified record gives, present it slide by slide, print it (one
 * slide per landscape page) or save the text. Only what passed every check is
 * on a slide; what the gate left out is counted here, never shown.
 */
import { useEffect, useMemo, useState } from 'react';
import { APP_VERSION } from '../../config/release';
import { buildDeck, deckText, hashDeck, type Deck, type DeckCase, type Slide } from '../../domain/presentation';
import type { Rotation } from '../../domain/types';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { TERMS } from '../../i18n/terms';
import { deckCase } from '../../presentation/input';
import { Icon } from '../components/Icon';
import { Banner, Button, Card, CheckboxField, PageTitle, SelectField } from '../components/ui';
import { useCases, useRotations } from '../data';
import { useSession } from '../session-context';

const label = (r: Rotation) => (r.department === 'other' ? (r.departmentOther ?? 'Other') : (TERMS[`dept.${r.department}`]?.en ?? r.department));

export function PresentationScreen() {
  const { t } = useI18n();
  const { store } = useSession();
  const rotations = useRotations();
  const cases = useCases();
  const [rotationId, setRotationId] = useState('');
  const [chosen, setChosen] = useState<Set<string> | undefined>();
  const [inputs, setInputs] = useState<DeckCase[] | undefined>();
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<string>();

  const rot = rotations.status === 'ready' ? rotations.data.find((r) => r.id === rotationId) : undefined;
  const mine = useMemo(() => (cases.status === 'ready' ? cases.data.filter((c) => c.rotationId === rotationId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) : []), [cases, rotationId]);
  const selected = useMemo(() => mine.filter((c) => (chosen ?? new Set(mine.map((x) => x.id))).has(c.id)), [mine, chosen]);
  const key = selected.map((c) => `${c.id}@${c.version}`).join(',');

  useEffect(() => {
    let live = true;
    setInputs(undefined);
    if (!selected.length) return;
    void Promise.all(selected.map((c) => deckCase(store, c.id))).then((all) => live && setInputs(all.filter((x): x is DeckCase => Boolean(x))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);

  const deck: Deck | undefined = useMemo(
    () => (rot && inputs ? buildDeck({ rotationLabel: label(rot), period: `${rot.startDate} – ${rot.endDate}`, today: store.today(), appVersion: APP_VERSION, cases: inputs }) : undefined),
    [rot, inputs, store],
  );
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, (deck?.slides.length ?? 1) - 1)));
  }, [deck]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!deck || (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(deck.slides.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [deck]);

  const record = async (as: 'pdf' | 'text') => {
    if (!deck || !rot) return;
    const hash = await hashDeck(deck);
    await store.recordPresentation(rot.id, { cases: deck.counts.cases, cards: deck.counts.cards, slides: deck.slides.length, hash, as });
    setDone(t('pres.audited', { hash: hash.slice(0, 12) }));
  };
  const print = async () => {
    await record('pdf');
    window.print();
  };
  const saveText = async () => {
    if (!deck) return;
    await record('text');
    const url = URL.createObjectURL(new Blob([deckText(deck)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `presentation-${rotationId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="presentation-screen">
      <div data-print="hide">
        <PageTitle back="#/reports">{t('pres.title')}</PageTitle>
      </div>
      <div className="flex flex-col gap-3" data-print="hide">
        <Banner tone="info">{t('pres.intro')}</Banner>
        {rotations.status === 'ready' && (
          <Card>
            <div className="flex flex-col gap-3">
              <SelectField
                label={t('pres.rotation')}
                name="pres-rotation"
                value={rotationId}
                onChange={(v) => {
                  setRotationId(v);
                  setChosen(undefined);
                  setIndex(0);
                }}
                options={rotations.data.map((r) => ({ value: r.id, label: `${label(r)} · ${r.startDate} – ${r.endDate}` }))}
              />
              {rotationId && mine.length === 0 && <p className="text-sm text-slate-600">{t('pres.noCases')}</p>}
              {mine.map((c) => (
                <CheckboxField
                  key={c.id}
                  name={`pres-case-${c.id}`}
                  label={`${c.id} · ${c.demographics.ageYears >= 90 ? '90+' : c.demographics.ageYears} ${c.demographics.sex}`}
                  checked={(chosen ?? new Set(mine.map((x) => x.id))).has(c.id)}
                  onChange={(on) => {
                    const next = new Set(chosen ?? mine.map((x) => x.id));
                    if (on) next.add(c.id);
                    else next.delete(c.id);
                    setChosen(next);
                  }}
                />
              ))}
            </div>
          </Card>
        )}
      </div>

      {deck && (
        <>
          {deck.notIncluded.length > 0 && (
            <div data-print="hide">
              <Banner tone="warning" role="status">
                <p className="font-medium" data-testid="pres-not-included">
                  {t('pres.notIncluded', { n: deck.notIncluded.length })}
                </p>
                <ul className="mt-1 list-disc ps-5 text-xs">
                  {deck.notIncluded.map((x, i) => (
                    <li key={i}>
                      {x.caseId}: {x.problem} — {t(`form.excluded.${x.reason}` as MsgKey)}
                    </li>
                  ))}
                </ul>
              </Banner>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <Button icon="chevron-back" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
              {t('lib.prev')}
            </Button>
            <span className="text-sm text-slate-700" data-testid="pres-position">
              {t('pres.position', { n: index + 1, total: deck.slides.length })}
            </span>
            <Button icon="chevron-forward" onClick={() => setIndex((i) => Math.min(deck.slides.length - 1, i + 1))} disabled={index >= deck.slides.length - 1}>
              {t('lib.next')}
            </Button>
            <Button variant="primary" icon="download" onClick={() => void print()} data-testid="pres-print">
              {t('pres.print')}
            </Button>
            <Button icon="file-text" onClick={() => void saveText()} data-testid="pres-text">
              {t('pres.text')}
            </Button>
            {done && (
              <span className="text-xs text-emerald-900" role="status" data-testid="pres-audited">
                {done}
              </span>
            )}
          </div>
          <div className="deck flex flex-col gap-4" data-testid="deck">
            {deck.slides.map((s, i) => (
              <SlideView key={i} s={s} n={i + 1} total={deck.slides.length} current={i === index} />
            ))}
          </div>
        </>
      )}
      {!deck && rotationId && selected.length > 0 && <p className="text-slate-600">{t('common.loading')}</p>}
    </div>
  );
}

function SlideView({ s, n, total, current }: { s: Slide; n: number; total: number; current: boolean }) {
  return (
    <section
      className={`slide flex-col gap-3 rounded-2xl border border-line bg-white p-6 shadow-card print:border-0 print:shadow-none ${current ? 'flex' : 'hidden print:flex'}`}
      data-testid="slide"
      data-kind={s.kind}
      data-current={current}
      aria-hidden={!current}
    >
      <h2 className="text-2xl font-semibold text-slate-900" dir="auto">
        {s.title.en}
        {s.title.ar !== s.title.en && (
          <span lang="ar" dir="rtl" className="ms-3 text-base font-normal text-slate-600">
            {s.title.ar}
          </span>
        )}
      </h2>
      <ul className="flex flex-col gap-2 text-lg text-slate-900">
        {s.bullets.map((b, i) => (
          <li key={i} className="flex gap-2" dir="auto">
            <Icon name="minus" className="mt-1.5 h-4 w-4 shrink-0 text-teal-700" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {s.table && (
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              {s.table.columns.map((c) => (
                <th key={c} className="border border-slate-400 bg-slate-100 px-2 py-1 text-start">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="border border-slate-400 px-2 py-1" dir="auto">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-auto text-xs text-slate-500">
        {n} / {total}
      </p>
    </section>
  );
}
