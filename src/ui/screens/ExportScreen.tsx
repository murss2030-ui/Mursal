/**
 * Export of the department form (plan M6). The file is made from the very
 * view the form tab shows; while anything shown is unverified the export is
 * refused and the reasons are listed, each with where to resolve it. Printing
 * (save as PDF from the browser) and the text file both stay on the device and
 * are recorded in the audit log by what they are and their hash, never by
 * their content. PRECEPTOR sends the file nowhere.
 */
import { useEffect, useMemo, useState } from 'react';
import { RELEASE_GATE_MET, APP_VERSION } from '../../config/release';
import { buildExport, documentText, hashDocument, type ExportBlocker, type ExportDocument } from '../../domain/form/export';
import type { CopyMode } from '../../domain/form/derive';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { Banner, Button, PageTitle } from '../components/ui';
import { useCaseBundle } from '../case-bundle';
import { useSession } from '../session-context';
import { useFormView } from './useFormView';

const TARGET = (caseId: string, b: ExportBlocker): string => {
  switch (b.code) {
    case 'excluded_card':
      return `#/cases/${caseId}/problems`;
    case 'pending_extraction':
      return `#/cases/${caseId}/analyse`;
    default:
      return `#/cases/${caseId}/form`;
  }
};

export function ExportScreen({ caseId, copy }: { caseId: string; copy: CopyMode }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  return <Exporter c={state.b.case} copy={copy} />;
}

function Exporter({ c, copy }: { c: import('../../domain/types').Case; copy: CopyMode }) {
  const { t } = useI18n();
  const { store } = useSession();
  const view = useFormView(c, copy);
  const [pending, setPending] = useState<number | undefined>();
  const [hashed, setHashed] = useState<{ text: string; hash: string } | undefined>();
  const [done, setDone] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    void store.pendingExtractionCount(c.id).then((n) => live && setPending(n));
    return () => {
      live = false;
    };
  }, [store, c.id, view]);
  const result = useMemo(
    () => (view && pending !== undefined ? buildExport(view, { pendingExtractions: pending, releaseGateMet: RELEASE_GATE_MET, caseKind: c.kind, caseId: c.id, today: store.today(), appVersion: APP_VERSION }) : undefined),
    [view, pending, c.kind, c.id, store],
  );
  // The hash is keyed on the document's text, which is stable, not on the identity of the object derived each render.
  const built = result?.ok ? result.doc : undefined;
  const text = built ? documentText(built) : undefined;
  useEffect(() => {
    if (!built || text === undefined) return;
    let live = true;
    void hashDocument(built).then((hash) => live && setHashed({ text, hash }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const doc: ExportDocument | undefined = built && hashed && hashed.text === text ? { ...built, hash: hashed.hash } : undefined;

  const record = async (as: 'pdf' | 'text') => {
    if (!doc?.hash) return;
    await store.recordFormExport(c.id, { copy: doc.copy, sections: doc.sections.length, missing: doc.missing.length, hash: doc.hash, as });
    setDone(t('export.audited', { hash: doc.hash.slice(0, 12) }));
  };
  const print = async () => {
    await record('pdf');
    window.print();
  };
  const saveText = async () => {
    if (!doc) return;
    await record('text');
    const url = URL.createObjectURL(new Blob([documentText(doc)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `form-${c.id}-${doc.copy}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!view || !result) return <p className="text-slate-600">{t('common.loading')}</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="export-screen">
      <div data-print="hide">
        <PageTitle back={`#/cases/${c.id}/form`}>{t('export.title')}</PageTitle>
      </div>
      <div className="flex flex-col gap-3" data-print="hide">
        <Banner tone="info">{t('export.intro')}</Banner>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('form.copy')}>
          {(['teaching', 'ward'] as const).map((m) => (
            <a
              key={m}
              href={`#/cases/${c.id}/export?copy=${m}`}
              aria-current={copy === m ? 'true' : undefined}
              className={`inline-flex min-h-touch items-center rounded-full border px-3 text-sm ${copy === m ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
            >
              {t(`export.copy.${m}` as MsgKey)}
            </a>
          ))}
        </div>
      </div>

      {!result.ok && (
        <div data-print="hide">
          <Banner tone="danger" role="alert">
            <p className="font-medium" data-testid="export-blocked">
              {t('export.blockedTitle', { n: result.blockers.length })}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm" data-testid="export-blockers">
              {result.blockers.map((b, i) => (
                <li key={i} data-blocker={b.code}>
                  <Blocker b={b} />{' '}
                  <a className="underline" href={TARGET(c.id, b)}>
                    {t('export.resolve')}
                  </a>
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {result.ok && doc && (
        <>
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <Button variant="primary" icon="download" onClick={() => void print()} data-testid="export-print">
              {t('export.print')}
            </Button>
            <Button icon="file-text" onClick={() => void saveText()} data-testid="export-text">
              {t('export.text')}
            </Button>
            {done && (
              <span className="text-xs text-emerald-900" role="status" data-testid="export-audited">
                {done}
              </span>
            )}
          </div>
          <Document doc={doc} />
        </>
      )}
    </div>
  );
}

function Blocker({ b }: { b: ExportBlocker }) {
  const { t } = useI18n();
  switch (b.code) {
    case 'ward_copy_not_allowed':
      return <>{t(`export.b.ward.${b.why}` as MsgKey)}</>;
    case 'unverified_value':
      return <>{t('export.b.unverified_value', { n: b.section, label: b.label.en, state: b.provenance === 'ai_suggestion' ? t('export.state.ai_suggestion') : t('export.state.extracted_unverified') })}</>;
    case 'excluded_card':
      return <>{t('export.b.excluded_card', { n: b.section, problem: b.problem, why: t(`form.excluded.${b.reason}` as MsgKey) })}</>;
    case 'calc_out_of_date':
      return <>{t('export.b.calc_out_of_date', { n: b.section })}</>;
    case 'data_conflict':
      return <>{t('export.b.data_conflict', { n: b.section, note: b.note })}</>;
    case 'pending_extraction':
      return <>{t('export.b.pending_extraction', { n: b.n })}</>;
  }
}

function Document({ doc }: { doc: ExportDocument }) {
  const { t } = useI18n();
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 print:border-0 print:p-0" data-testid="export-document" data-copy={doc.copy} data-hash={doc.hash}>
      <header>
        <h1 className="text-xl font-semibold" lang="en">
          {doc.title.en}
        </h1>
        <p className="text-sm text-slate-700" lang="ar" dir="rtl">
          {doc.title.ar}
        </p>
        <p className="mt-1 text-xs text-slate-600">{doc.statement[0]}</p>
      </header>
      {doc.sections.map((s) => (
        <section key={s.number} className="export-section flex flex-col gap-2 border-t border-slate-300 pt-3" data-section={s.number}>
          <h2 className="text-base font-semibold">
            <span lang="en">
              {s.number}. {s.title.en}
            </span>{' '}
            <span lang="ar" dir="rtl" className="text-sm font-normal text-slate-700">
              {s.title.ar}
            </span>
          </h2>
          <dl className="grid grid-cols-[minmax(7rem,12rem)_1fr] gap-x-3 gap-y-1 text-sm">
            {s.lines.map((l) => (
              <div key={l.label.en} className="contents">
                <dt className="text-slate-600">
                  <span lang="en">{l.label.en}</span>
                </dt>
                <dd className="whitespace-pre-wrap" dir="auto">
                  {l.text || <span className="block min-h-[1.6rem] border-b border-slate-500" />}
                </dd>
              </div>
            ))}
          </dl>
          {s.table && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" data-table={s.number}>
                <thead>
                  <tr>
                    {s.table.columns.map((c) => (
                      <th key={c.en} className="border border-slate-400 bg-slate-100 px-1.5 py-1 text-start font-medium">
                        {c.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((cell, j) => (
                        <td key={j} className="whitespace-pre-wrap border border-slate-400 px-1.5 py-1 align-top" dir="auto">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {s.table.rows.length === 0 && (
                    <tr>
                      <td colSpan={s.table.columns.length} className="border border-slate-400 px-1.5 py-1 text-slate-600">
                        {s.table.empty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {s.checkboxes && (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
              {s.checkboxes.map((c) => (
                <li key={c.label.en} data-ticked={String(c.ticked)}>
                  {c.ticked === null ? '? ' : c.ticked ? '☒ ' : '☐ '}
                  {c.label.en}
                </li>
              ))}
            </ul>
          )}
          {s.automatic && (
            <div className="text-xs">
              <p className="font-medium">{s.automatic.title}</p>
              {s.automatic.rows.length > 0 && (
                <table className="mt-1 w-full border-collapse">
                  <tbody>
                    {s.automatic.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((cell, j) => (
                          <td key={j} className="whitespace-pre-wrap border border-slate-400 px-1.5 py-1 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.automatic.notes.map((n, i) => (
                <p key={i} className="text-slate-700">
                  {n}
                </p>
              ))}
            </div>
          )}
          {s.leftOut.length > 0 && (
            <ul className="text-xs text-slate-700">
              {s.leftOut.map((x, i) => (
                <li key={i}>
                  {t('export.leftOut')}: {x}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {doc.missing.length > 0 && (
        <section className="export-section border-t border-slate-300 pt-3" data-testid="export-missing">
          <h2 className="text-base font-semibold">{t('export.missing', { n: doc.missing.length })}</h2>
          <ul className="text-sm">
            {doc.missing.map((m, i) => (
              <li key={i}>
                {t('form.section', { n: m.section })}: {m.label}
                {m.why ? ` — ${m.why}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="border-t border-slate-300 pt-2 text-[11px] text-slate-700" data-testid="export-statement">
        {doc.statement.slice(1).map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        <p className="font-mono">SHA-256 {doc.hash}</p>
      </footer>
    </article>
  );
}
