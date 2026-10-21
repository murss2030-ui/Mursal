/**
 * The trainee's evidence library (Section 11, plan M5a): guideline PDFs the
 * trainee obtained lawfully, kept encrypted on this device. The trainee types
 * or confirms every item of the record (a model never fills it in), chooses
 * whether the text may ever be sent to the AI service (default: local search
 * only), searches the passages, and opens the page a passage came from.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AGE_WARNING_YEARS, citationOf, documentAge, isOld, maySend, type DocumentMetaInput, type EvidenceChunk, type LibraryDocument } from '../../domain/library';
import { ValidationError } from '../../domain/validation';
import { matchDrug } from '../../drugs/normalize';
import { useVocabulary } from '../../drugs/useVocabulary';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { AiError } from '../../ai/client';
import { embedDocument, searchLibrary, type LibrarySearch } from '../../library/run';
import { Banner, Button, Card, CheckboxField, Chip, LinkButton, PageTitle, RadioGroup, TextAreaField, TextField } from '../components/ui';
import { useChunks, useDocumentHistory, useDocuments } from '../data';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { loadPdf, type LoadedPdf } from '../pdf';

const ERR: Record<string, MsgKey> = {
  required: 'err.required',
  tooLong: 'err.tooLong',
  range: 'err.range',
  invalidChoice: 'err.invalidChoice',
  confirm: 'lib.err.licenceConfirm',
  tooLarge: 'err.tooLarge',
};

/** How long a passage is shown in a list before "show more". */
const SNIPPET = 420;

const emptyMeta = (today: string): Record<string, string> => ({ title: '', publisher: '', year: '', edition: '', url: '', licence: '', topic: '', retrievedOn: today, role: 'primary', aiUse: 'local_only', licenceConfirmed: '' });

const metaOf = (d: LibraryDocument): Record<string, string> => ({
  title: d.title,
  publisher: d.publisher,
  year: String(d.year),
  edition: d.edition ?? '',
  url: d.url ?? '',
  licence: d.licence,
  topic: d.topic ?? '',
  retrievedOn: d.retrievedOn,
  role: d.role,
  aiUse: d.aiUse,
  // A choice already confirmed stays confirmed; changing the licence text asks again.
  licenceConfirmed: d.aiUse === 'may_send' ? 'yes' : '',
});

const toInput = (v: Record<string, string>): DocumentMetaInput => ({
  title: v.title ?? '',
  publisher: v.publisher ?? '',
  year: v.year ?? '',
  edition: v.edition ?? '',
  url: v.url ?? '',
  licence: v.licence ?? '',
  aiUse: v.aiUse ?? '',
  licenceConfirmed: v.licenceConfirmed ?? '',
  role: v.role ?? '',
  topic: v.topic ?? '',
  retrievedOn: v.retrievedOn ?? '',
});

function useErrors() {
  const { t } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const show = (e: unknown) => {
    if (e instanceof ValidationError) setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, c]) => [k, t(ERR[c as string] ?? 'err.invalidChoice')])));
    else setErrors({ save: e instanceof Error ? e.message : String(e) });
  };
  return { errors, show, clear: () => setErrors({}) };
}

export const DocChips = ({ doc, today }: { doc: LibraryDocument; today: string }) => {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Chip tone={doc.role === 'primary' ? 'teal' : 'slate'}>{t(`lib.role.${doc.role}` as MsgKey)}</Chip>
      <Chip tone={doc.aiUse === 'may_send' ? 'violet' : 'slate'}>{t(`lib.aiUse.${doc.aiUse}` as MsgKey)}</Chip>
      {isOld(doc, today) && <Chip tone="amber">{t('lib.old', { n: documentAge(doc, today), limit: AGE_WARNING_YEARS })}</Chip>}
      {!doc.textLayer && <Chip tone="red">{t('lib.noText')}</Chip>}
    </span>
  );
};

// ---------------------------------------------------------------- the list, the search and the form to add

export function LibraryScreen() {
  const { t } = useI18n();
  const { store } = useSession();
  const docs = useDocuments();
  const today = store.today();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<LibrarySearch | undefined>();
  const [searchError, setSearchError] = useState<string | undefined>();

  if (docs.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (docs.status === 'error') return <Banner tone="danger">{docs.error.message}</Banner>;
  const active = docs.data.filter((d) => d.status === 'active');
  const removed = docs.data.filter((d) => d.status === 'removed');

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setSearchError(undefined);
    try {
      setFound(await searchLibrary(store, query.trim(), { caseKind: 'teaching' }));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/resources">{t('lib.title')}</PageTitle>
      <Banner tone="info">{t('lib.intro')}</Banner>

      {active.length > 0 && (
        <Card title={t('lib.search')}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <TextField label={t('lib.searchLabel')} hint={t('lib.searchHint')} value={query} onChange={setQuery} name="library-query" />
            <div>
              <Button type="submit" variant="primary" icon="search" disabled={busy || !query.trim()}>
                {busy ? t('lib.searching') : t('lib.searchGo')}
              </Button>
            </div>
          </form>
          {searchError && (
            <Banner tone="danger" role="alert" className="mt-3">
              {searchError}
            </Banner>
          )}
          {found && <SearchResults found={found} query={query} today={today} />}
        </Card>
      )}

      <Card
        title={t('lib.documents')}
        actions={
          !adding && (
            <Button icon="plus" onClick={() => setAdding(true)}>
              {t('lib.add')}
            </Button>
          )
        }
      >
        {adding && <AddDocument today={today} onDone={() => setAdding(false)} />}
        {active.length === 0 && !adding && <p className="text-sm text-slate-600">{t('lib.empty')}</p>}
        <ul className="flex flex-col gap-2">
          {active.map((d) => (
            <li key={d.id}>
              <a href={`#/library/${d.id}`} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-teal-600">
                <span className="font-medium text-slate-900">{d.title}</span>
                <span className="text-sm text-slate-600">
                  {d.publisher}, {d.year}
                  {d.edition ? ` (${d.edition})` : ''} · {t('lib.pagesChunks', { pages: d.file.pages, chunks: d.chunks })}
                </span>
                <DocChips doc={d} today={today} />
              </a>
            </li>
          ))}
        </ul>
        {removed.length > 0 && <p className="mt-3 text-xs text-slate-600">{t('lib.removedCount', { n: removed.length })}</p>}
      </Card>
    </div>
  );
}

export function SearchResults({ found, query, today }: { found: LibrarySearch; query: string; today: string }) {
  const { t } = useI18n();
  void today;
  return (
    <div className="mt-3 flex flex-col gap-3" data-testid="library-results">
      <p className="text-xs text-slate-600" role="status">
        {found.byMeaning ? t('lib.byMeaning') : t('lib.byWords')}
        {found.meaningSkipped ? ` ${t('lib.meaningSkipped', { why: found.meaningSkipped })}` : ''}
      </p>
      {found.hits.length === 0 && <p className="text-sm text-slate-700">{t('lib.noHits', { q: query })}</p>}
      <ul className="flex flex-col gap-2">
        {found.hits.map((h) => (
          <li key={h.chunk.id}>
            <Passage chunk={h.chunk} citation={h.citation} old={h.old} docId={h.doc.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One passage with its citation, the way it is cited, and where to read it in the document. */
export function Passage({ chunk, citation, old, docId }: { chunk: EvidenceChunk; citation: string; old: boolean; docId: string }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const long = chunk.text.length > SNIPPET;
  const text = more || !long ? chunk.text : `${chunk.text.slice(0, SNIPPET).trimEnd()}…`;
  const adjust = new URLSearchParams({ text: chunk.text.slice(0, 2000), source: citation.slice(0, 300) });
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3" data-testid="passage">
      <p className="text-sm font-medium text-slate-900">{citation}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1">
        <Chip>{t(`lib.kind.${chunk.kind}` as MsgKey)}</Chip>
        {chunk.strength && <Chip tone="teal">{t('lib.strength', { s: chunk.strength })}</Chip>}
        {old && <Chip tone="amber">{t('lib.oldCitation')}</Chip>}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800" dir="auto">
        {text}
      </p>
      {long && (
        <button type="button" className="mt-1 text-sm text-teal-800 underline" onClick={() => setMore(!more)}>
          {more ? t('lib.less') : t('lib.more')}
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <LinkButton href={`#/library/${docId}/page/${chunk.page}`} icon="file-text">
          {t('lib.openPage', { n: chunk.page })}
        </LinkButton>
        {chunk.kind === 'table' && (
          <LinkButton href={`#/reference/adjustment/new?${adjust.toString()}`} icon="pill">
            {t('lib.addToTable')}
          </LinkButton>
        )}
      </div>
    </article>
  );
}

function AddDocument({ today, onDone }: { today: string; onDone: () => void }) {
  const { t } = useI18n();
  const { store } = useSession();
  const vocabulary = useVocabulary();
  const [file, setFile] = useState<File | undefined>();
  const [pdf, setPdf] = useState<LoadedPdf | undefined>();
  const [v, setV] = useState<Record<string, string>>(() => emptyMeta(today));
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const { errors, show, clear } = useErrors();

  useEffect(() => () => pdf?.destroy(), [pdf]);

  const set = (k: string) => (x: string) => setV((p) => ({ ...p, [k]: x }));

  const choose = async (f: File | undefined) => {
    clear();
    setFile(f);
    setPdf((old) => {
      old?.destroy();
      return undefined;
    });
    if (!f) return;
    setReading(true);
    try {
      const p = await loadPdf(f);
      setPdf(p);
      // What the file says about itself is offered, never applied silently: the trainee confirms or types over it.
      const info = await p.info();
      setV((prev) => ({ ...prev, title: prev.title || info.title || f.name.replace(/\.pdf$/i, ''), publisher: prev.publisher || info.author || '', year: prev.year || (info.year ? String(info.year) : '') }));
    } catch {
      setFile(undefined);
      show(new ValidationError({ file: 'invalidChoice' }));
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    clear();
    if (!file || !pdf) {
      show(new ValidationError({ file: 'required' }));
      return;
    }
    setBusy(true);
    try {
      const pages = await pdf.textPages();
      const vocab = vocabulary.status === 'ready' ? vocabulary.vocab : undefined;
      const isDrug = vocab ? (w: string) => matchDrug(w, vocab).status === 'matched' : undefined;
      const doc = await store.addDocument({ meta: toInput(v), file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, pages, pageCount: pdf.pages, ...(isDrug ? { isDrug } : {}) });
      navigate(`/library/${doc.id}`);
      onDone();
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mb-4 flex flex-col gap-3 rounded-lg border border-teal-700 bg-teal-50/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="add-document"
    >
      <Banner tone="warning">{t('lib.lawful')}</Banner>
      <div className="flex flex-col gap-1">
        <label htmlFor="library-file" className="text-sm font-medium text-slate-800">
          {t('lib.file')}
        </label>
        <input id="library-file" type="file" accept="application/pdf,.pdf" onChange={(e) => void choose(e.target.files?.[0])} className="text-sm" />
        {reading && <p className="text-xs text-slate-600">{t('lib.reading')}</p>}
        {errors.file && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {errors.file}
          </p>
        )}
        {pdf && <p className="text-xs text-slate-600">{t('lib.fileOk', { pages: pdf.pages })}</p>}
      </div>
      <MetaFields v={v} set={set} errors={errors} />
      {errors.save && (
        <Banner tone="danger" role="alert">
          {errors.save}
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || reading || !pdf}>
          {busy ? t('lib.indexing') : t('lib.addSave')}
        </Button>
        <Button onClick={onDone} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The record the trainee types or confirms; the licence gate sits with the AI-use choice. */
function MetaFields({ v, set, errors }: { v: Record<string, string>; set: (k: string) => (x: string) => void; errors: Record<string, string> }) {
  const { t } = useI18n();
  return (
    <>
      <TextField label={t('lib.f.title')} value={v.title ?? ''} onChange={set('title')} error={errors.title} />
      <TextField label={t('lib.f.publisher')} hint={t('lib.f.publisherHint')} value={v.publisher ?? ''} onChange={set('publisher')} error={errors.publisher} />
      <TextField label={t('lib.f.year')} inputMode="numeric" value={v.year ?? ''} onChange={set('year')} error={errors.year} />
      <TextField label={t('lib.f.edition')} optional value={v.edition ?? ''} onChange={set('edition')} error={errors.edition} />
      <TextField label={t('lib.f.url')} optional hint={t('lib.f.urlHint')} value={v.url ?? ''} onChange={set('url')} error={errors.url} />
      <TextField label={t('lib.f.licence')} hint={t('lib.f.licenceHint')} value={v.licence ?? ''} onChange={set('licence')} error={errors.licence} />
      <TextField label={t('lib.f.topic')} optional value={v.topic ?? ''} onChange={set('topic')} error={errors.topic} />
      <TextField label={t('lib.f.retrievedOn')} type="date" value={v.retrievedOn ?? ''} onChange={set('retrievedOn')} error={errors.retrievedOn} />
      <RadioGroup
        name="lib-role"
        label={t('lib.f.role')}
        value={v.role ?? 'primary'}
        onChange={set('role')}
        error={errors.role}
        options={[
          { value: 'primary', label: t('lib.role.primary'), help: t('lib.role.primaryHelp') },
          { value: 'reference', label: t('lib.role.reference'), help: t('lib.role.referenceHelp') },
        ]}
      />
      <RadioGroup
        name="lib-aiuse"
        label={t('lib.f.aiUse')}
        value={v.aiUse ?? 'local_only'}
        onChange={(x) => {
          set('aiUse')(x);
          if (x !== 'may_send') set('licenceConfirmed')('');
        }}
        error={errors.aiUse}
        options={[
          { value: 'local_only', label: t('lib.aiUse.local_only'), help: t('lib.aiUse.localHelp') },
          { value: 'may_send', label: t('lib.aiUse.may_send'), help: t('lib.aiUse.sendHelp') },
        ]}
      />
      {v.aiUse === 'may_send' && (
        <CheckboxField name="lib-licence-ok" label={t('lib.f.licenceOk')} checked={v.licenceConfirmed === 'yes'} onChange={(c) => set('licenceConfirmed')(c ? 'yes' : '')} error={errors.licenceConfirmed} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- one document

export function LibraryDocumentScreen({ docId }: { docId: string }) {
  const { t, when } = useI18n();
  const { store } = useSession();
  const docs = useDocuments();
  const chunks = useChunks(docId);
  const history = useDocumentHistory(docId);
  const doc = docs.status === 'ready' ? docs.data.find((d) => d.id === docId) : undefined;
  const today = store.today();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (docs.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (docs.status === 'error') return <Banner tone="danger">{docs.error.message}</Banner>;
  if (!doc) return <Banner tone="warning">{t('lib.notFound')}</Banner>;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/library">{doc.title}</PageTitle>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <Row k={t('lib.f.publisher')} v={doc.publisher} />
          <Row k={t('lib.f.year')} v={`${doc.year}${doc.edition ? ` (${doc.edition})` : ''}`} />
          <Row k={t('lib.f.licence')} v={doc.licence} />
          {doc.url && <Row k={t('lib.f.url')} v={doc.url} />}
          {doc.topic && <Row k={t('lib.f.topic')} v={doc.topic} />}
          <Row k={t('lib.f.retrievedOn')} v={doc.retrievedOn} />
          <Row k={t('lib.file')} v={t('lib.fileLine', { name: doc.file.name, pages: doc.file.pages, kb: Math.round(doc.file.bytes / 1024) })} />
          <Row k="SHA-256" v={<code className="break-all text-xs">{doc.file.sha256}</code>} />
        </dl>
        <div className="mt-2">
          <DocChips doc={doc} today={today} />
        </div>
        {isOld(doc, today) && (
          <Banner tone="warning" className="mt-3">
            {t('lib.oldBanner', { n: documentAge(doc, today), limit: AGE_WARNING_YEARS })}
          </Banner>
        )}
        {!doc.textLayer && (
          <Banner tone="danger" className="mt-3">
            {t('lib.noTextBanner')}
          </Banner>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href={`#/library/${doc.id}/page/1`} icon="file-text">
            {t('lib.openFirst')}
          </LinkButton>
          {!editing && <Button onClick={() => setEditing(true)}>{t('lib.editRecord')}</Button>}
          {!removing && (
            <Button variant="danger" onClick={() => setRemoving(true)}>
              {t('lib.remove')}
            </Button>
          )}
        </div>
      </Card>

      {editing && <EditRecord key={doc.version} doc={doc} onDone={() => setEditing(false)} />}
      {removing && <RemoveDocument doc={doc} onDone={() => setRemoving(false)} />}

      <Vectors doc={doc} when={when} />

      <Card title={t('lib.passages', { n: doc.chunks })}>
        {chunks.status === 'loading' && <p className="text-slate-600">{t('common.loading')}</p>}
        {chunks.status === 'error' && <Banner tone="danger">{chunks.error.message}</Banner>}
        {chunks.status === 'ready' && <PassageList doc={doc} chunks={chunks.data} today={today} />}
      </Card>

      {history.status === 'ready' && history.data.length > 1 && (
        <Card title={t('lib.history')}>
          <ol className="flex flex-col gap-1 text-sm">
            {[...history.data].reverse().map((h) => (
              <li key={h.version}>
                <span className="font-medium">v{h.version}</span> · {when(h.versionCreatedAt)}
                {h.changeReason ? ` — ${h.changeReason}` : ''}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <>
    <dt className="text-slate-600">{k}</dt>
    <dd className="min-w-0 text-slate-900">{v}</dd>
  </>
);

const PAGE = 25;

function PassageList({ doc, chunks, today }: { doc: LibraryDocument; chunks: EvidenceChunk[]; today: string }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  const old = isOld(doc, today);
  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return chunks.filter((c) => !q || c.text.toLowerCase().includes(q) || c.sectionPath.join(' ').toLowerCase().includes(q)).sort((a, b) => a.n - b.n);
  }, [chunks, filter]);
  if (!chunks.length) return <p className="text-sm text-slate-600">{t('lib.noPassages')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <TextField label={t('lib.filter')} value={filter} onChange={setFilter} />
      <ul className="flex flex-col gap-2">
        {list.slice(0, shown).map((c) => (
          <li key={c.id}>
            <Passage chunk={c} citation={citationOf(doc, c)} old={old} docId={doc.id} />
          </li>
        ))}
      </ul>
      {list.length > shown && <Button onClick={() => setShown(shown + PAGE)}>{t('lib.showMore', { n: list.length - shown })}</Button>}
    </div>
  );
}

function EditRecord({ doc, onDone }: { doc: LibraryDocument; onDone: () => void }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [v, setV] = useState<Record<string, string>>(() => ({ ...metaOf(doc), reason: '' }));
  const [busy, setBusy] = useState(false);
  const { errors, show, clear } = useErrors();
  const set = (k: string) => (x: string) => setV((p) => ({ ...p, [k]: x }));
  const save = async () => {
    clear();
    setBusy(true);
    try {
      await store.updateDocument(doc.id, toInput(v), v.reason ?? '');
      onDone();
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('lib.editRecord')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <MetaFields v={v} set={set} errors={errors} />
        {doc.aiUse === 'may_send' && v.aiUse !== 'may_send' && <Banner tone="warning">{t('lib.vectorsWillGo')}</Banner>}
        <TextAreaField label={t('common.reason')} hint={t('common.reasonHint')} value={v.reason ?? ''} onChange={set('reason')} error={errors.reason} rows={2} />
        {errors.save && (
          <Banner tone="danger" role="alert">
            {errors.save}
          </Banner>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {t('common.save')}
          </Button>
          <Button onClick={onDone} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function RemoveDocument({ doc, onDone }: { doc: LibraryDocument; onDone: () => void }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, show, clear } = useErrors();
  const go = async () => {
    clear();
    setBusy(true);
    try {
      await store.removeDocument(doc.id, reason);
      navigate('/library');
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('lib.remove')}>
      <div className="flex flex-col gap-3">
        <Banner tone="warning">{t('lib.removeWarn')}</Banner>
        <TextAreaField label={t('common.reason')} hint={t('common.reasonHint')} value={reason} onChange={setReason} error={errors.reason} rows={2} />
        {errors.save && (
          <Banner tone="danger" role="alert">
            {errors.save}
          </Banner>
        )}
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => void go()} disabled={busy}>
            {t('lib.removeConfirm')}
          </Button>
          <Button onClick={onDone} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Search by meaning: only for a document whose text may be sent, with an embedding model chosen in the AI settings. */
function Vectors({ doc, when }: { doc: LibraryDocument; when: (iso: string) => string }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [progress, setProgress] = useState<[number, number] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const send = maySend(doc);

  const run = async () => {
    setError(undefined);
    setProgress([0, doc.chunks]);
    try {
      await embedDocument(store, doc.id, {}, (done, total) => setProgress([done, total]));
    } catch (e) {
      setError(e instanceof AiError ? `${e.message}` : e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <Card title={t('lib.meaning')}>
      {!send && <p className="text-sm text-slate-700">{t('lib.meaningLocal')}</p>}
      {send && doc.vectors && <p className="text-sm text-slate-800">{t('lib.meaningDone', { model: doc.vectors.model, n: doc.vectors.chunks, at: when(doc.vectors.at) })}</p>}
      {send && !doc.vectors && <p className="text-sm text-slate-700">{t('lib.meaningNone')}</p>}
      {send && (
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <Button onClick={() => void run()} disabled={Boolean(progress) || !doc.textLayer}>
              {progress ? t('lib.meaningRunning', { done: progress[0], total: progress[1] }) : doc.vectors ? t('lib.meaningRedo') : t('lib.meaningGo')}
            </Button>
          </div>
          <p className="text-xs text-slate-600">{t('lib.meaningCost')}</p>
        </div>
      )}
      {error && (
        <Banner tone="danger" role="alert" className="mt-3">
          {error}
        </Banner>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- the page a citation points to

/** Renders one page of the stored PDF on the device (pdf.js; the Content-Security-Policy forbids embedded viewers). */
export function LibraryPageScreen({ docId, page }: { docId: string; page: number }) {
  const { t } = useI18n();
  const { store } = useSession();
  const docs = useDocuments();
  const chunks = useChunks(docId);
  const doc = docs.status === 'ready' ? docs.data.find((d) => d.id === docId) : undefined;
  const host = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<LoadedPdf | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [pages, setPages] = useState(0);
  const n = Math.max(1, Math.min(page, pages || page));

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const bytes = await store.documentFile(docId);
        if (!bytes) return live && setState('missing');
        const p = await loadPdf(new File([bytes as BlobPart], 'document.pdf', { type: 'application/pdf' }));
        if (!live) return p.destroy();
        pdfRef.current = p;
        setPages(p.pages);
        setState('ready');
      } catch {
        if (live) setState('error');
      }
    })();
    return () => {
      live = false;
      pdfRef.current?.destroy();
      pdfRef.current = undefined;
    };
  }, [store, docId]);

  useEffect(() => {
    const p = pdfRef.current;
    if (state !== 'ready' || !p || !host.current) return;
    let live = true;
    void p.renderPage(n).then((canvas) => {
      if (!live || !host.current) return;
      canvas.className = 'h-auto max-w-full rounded border border-slate-300';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', t('lib.pageAlt', { n }));
      host.current.replaceChildren(canvas);
    });
    return () => {
      live = false;
    };
  }, [state, n, t]);

  const here = chunks.status === 'ready' ? chunks.data.filter((c) => c.page <= n && (c.pageEnd ?? c.page) >= n).sort((a, b) => a.n - b.n) : [];

  return (
    <div className="flex flex-col gap-3">
      <PageTitle back={`#/library/${docId}`}>{doc ? doc.title : t('lib.title')}</PageTitle>
      {state === 'loading' && <p className="text-slate-600">{t('common.loading')}</p>}
      {state === 'missing' && <Banner tone="warning">{t('lib.fileMissing')}</Banner>}
      {state === 'error' && <Banner tone="danger">{t('lib.pageError')}</Banner>}
      {state === 'ready' && (
        <>
          <div className="flex items-center justify-between gap-2">
            <LinkButton href={`#/library/${docId}/page/${Math.max(1, n - 1)}`} icon="chevron-back">
              {t('lib.prev')}
            </LinkButton>
            <span className="text-sm text-slate-700" data-testid="page-number">
              {t('lib.pageOf', { n, total: pages })}
            </span>
            <LinkButton href={`#/library/${docId}/page/${Math.min(pages, n + 1)}`} icon="chevron-forward">
              {t('lib.next')}
            </LinkButton>
          </div>
          <div ref={host} data-testid="page-canvas" className="overflow-auto" />
          {doc && here.length > 0 && (
            <Card title={t('lib.onThisPage')}>
              <ul className="flex flex-col gap-2">
                {here.map((c) => (
                  <li key={c.id}>
                    <Passage chunk={c} citation={citationOf(doc, c)} old={isOld(doc, store.today())} docId={docId} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
