import { useRef, useState } from 'react';
import { RELEASE_GATE_MET } from '../../config/release';
import { hospitalDayOf } from '../../domain/dates';
import type { Attachment, Case, SourceDocType } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { Icon, type IconName } from '../components/Icon';
import { Banner, Button, DayLabel } from '../components/ui';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { loadPdf, MAX_PDF_PAGES, type LoadedPdf } from '../pdf';
import { SourceThumb } from './panels';
import { RedactionEditor, type PageSource } from './RedactionEditor';

export const TEXT_DRAFT_ID = (caseId: string) => `source:text:${caseId}`;

const MAX_TEXT_FILE = 2 * 1024 * 1024;

type Queue = { pages: PageSource[]; index: number; groupId: string; origin: 'camera' | 'image_file' | 'pdf_page'; docType: SourceDocType | '' };

function Tile({ icon, title, help, onClick, testId }: { icon: IconName; title: string; help: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="surface flex min-h-[96px] items-center gap-4 p-4 text-start transition-shadow hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
      data-testid={testId}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-saffron-300">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span className="flex flex-col">
        <span className="text-base font-semibold text-slate-900">{title}</span>
        <span className="text-sm text-slate-600">{help}</span>
      </span>
    </button>
  );
}

/**
 * The three ways into the patient file: type or paste, upload a file (text,
 * image or PDF), photograph pages. Images and PDF pages are redacted page by
 * page before anything is stored.
 */
export function AddSourceTiles({ c, back }: { c: Case; back: 'intake' | 'sources' }) {
  const { t } = useI18n();
  const { store } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [pdf, setPdf] = useState<{ doc: LoadedPdf; name: string } | null>(null);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [savedCount, setSavedCount] = useState(0);
  const todayDay = c.status === 'active' ? hospitalDayOf(c.admissionDay0, store.today()) : null;

  const openTextEditor = (text?: string, origin: 'typed' | 'text_file' = 'typed') => {
    const go = () => navigate(`/cases/${c.id}/sources/new/text?back=${back}${text !== undefined ? '&import=1' : ''}`);
    if (text === undefined) go();
    else void store.putUiDraft(TEXT_DRAFT_ID(c.id), { text, docType: '', day: '', title: '', origin }).then(go);
  };

  const startQueue = (pages: PageSource[], origin: Queue['origin']) => {
    if (!pages.length) return;
    setSavedCount(0);
    setQueue({ pages, index: 0, groupId: crypto.randomUUID(), origin, docType: '' });
  };

  const onFiles = async (files: FileList | null, fromCamera: boolean) => {
    setNotice(undefined);
    const list = [...(files ?? [])];
    if (!list.length) return;
    const text = list.find((f) => f.type === 'text/plain' || /\.txt$/i.test(f.name));
    const pdfFile = list.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const images = list.filter((f) => f.type.startsWith('image/'));
    const other = list.filter((f) => f !== text && f !== pdfFile && !images.includes(f));
    if (other.length) setNotice(t('intake.unsupported', { name: other.map((f) => f.name).join(', ') }));
    if (text) {
      if (text.size > MAX_TEXT_FILE) return setNotice(t('err.tooLarge'));
      openTextEditor(await text.text(), 'text_file');
      return;
    }
    if (pdfFile) {
      setBusy(t('intake.pdfLoading'));
      try {
        setPdf({ doc: await loadPdf(pdfFile), name: pdfFile.name });
      } catch {
        setNotice(t('intake.pdfFailed'));
      } finally {
        setBusy(undefined);
      }
      return;
    }
    startQueue(
      images.map((file) => ({ kind: 'file', file })),
      fromCamera ? 'camera' : 'image_file',
    );
  };

  const pdfAsImages = async () => {
    if (!pdf) return;
    const n = Math.min(pdf.doc.pages, MAX_PDF_PAGES);
    setBusy(t('intake.pdfRendering', { n }));
    try {
      const pages: PageSource[] = [];
      for (let i = 1; i <= n; i++) pages.push({ kind: 'canvas', canvas: await pdf.doc.renderPage(i), name: `${pdf.name} p${i}` });
      if (pdf.doc.pages > MAX_PDF_PAGES) setNotice(t('intake.pdfTooMany', { n: MAX_PDF_PAGES }));
      startQueue(pages, 'pdf_page');
    } catch {
      setNotice(t('intake.pdfFailed'));
    } finally {
      pdf.doc.destroy();
      setPdf(null);
      setBusy(undefined);
    }
  };

  const pdfAsText = async () => {
    if (!pdf) return;
    setBusy(t('intake.pdfReadingText'));
    try {
      const text = await pdf.doc.text();
      if (!text.trim()) {
        setNotice(t('intake.pdfNoText'));
        return;
      }
      pdf.doc.destroy();
      setPdf(null);
      openTextEditor(text, 'text_file');
    } finally {
      setBusy(undefined);
    }
  };

  const advance = () =>
    setQueue((q) => {
      if (!q) return null;
      return q.index + 1 < q.pages.length ? { ...q, index: q.index + 1 } : null;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3">
        <Tile icon="type" title={t('intake.typeTitle')} help={t('intake.typeHelp')} onClick={() => openTextEditor()} testId="add-text" />
        <Tile icon="file-plus" title={t('intake.uploadTitle')} help={t('intake.uploadHelp')} onClick={() => fileRef.current?.click()} testId="add-file" />
        <Tile icon="camera" title={t('intake.cameraTitle')} help={t('intake.cameraHelp')} onClick={() => camRef.current?.click()} testId="add-camera" />
      </div>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        accept=".txt,text/plain,application/pdf,.pdf,image/*"
        multiple
        data-testid="file-input"
        aria-label={t('intake.uploadTitle')}
        onChange={(e) => {
          void onFiles(e.target.files, false);
          e.target.value = '';
        }}
      />
      <input
        ref={camRef}
        type="file"
        className="sr-only"
        accept="image/*"
        capture="environment"
        multiple
        data-testid="camera-input"
        aria-label={t('intake.cameraTitle')}
        onChange={(e) => {
          void onFiles(e.target.files, true);
          e.target.value = '';
        }}
      />
      {!RELEASE_GATE_MET && <p className="text-xs text-slate-600">{t('intake.syntheticOnly')}</p>}
      {busy && (
        <Banner tone="info" role="status">
          {busy}
        </Banner>
      )}
      {notice && (
        <Banner tone="warning" role="alert">
          {notice}
        </Banner>
      )}
      {savedCount > 0 && !queue && (
        <Banner tone="success" role="status">
          {t('intake.pagesSaved', { n: savedCount })}
        </Banner>
      )}

      {pdf && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pdf-title">
          <div className="surface flex w-full max-w-md flex-col gap-3 p-4">
            <h2 id="pdf-title" className="text-lg font-semibold">
              {t('intake.pdfTitle')}
            </h2>
            <p className="text-sm text-slate-700">{t('intake.pdfLead', { name: pdf.name, n: pdf.doc.pages })}</p>
            <Button variant="primary" icon="image" onClick={() => void pdfAsImages()}>
              {t('intake.pdfAsImages')}
            </Button>
            <Button icon="type" onClick={() => void pdfAsText()}>
              {t('intake.pdfAsText')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                pdf.doc.destroy();
                setPdf(null);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {queue && (
        <RedactionEditor
          key={`${queue.groupId}:${queue.index}`}
          source={queue.pages[queue.index]!}
          index={queue.index}
          total={queue.pages.length}
          defaultDocType={queue.docType}
          todayDay={todayDay}
          onSave={async (p) => {
            await store.addAttachment(c.id, {
              kind: 'image',
              docType: p.docType,
              hospitalDay: p.hospitalDay,
              title: p.title,
              origin: queue.origin,
              groupId: queue.pages.length > 1 ? queue.groupId : undefined,
              page: queue.pages.length > 1 ? queue.index + 1 : undefined,
              redactionConfirmed: true,
              image: { bytes: p.bytes, thumb: p.thumb, width: p.width, height: p.height },
            });
            setSavedCount((n) => n + 1);
            setQueue((q) => (q ? { ...q, docType: p.docType } : q));
            advance();
          }}
          onSkip={advance}
          onCancel={() => setQueue(null)}
        />
      )}
    </div>
  );
}

export function SourceList({ caseId, attachments }: { caseId: string; attachments: readonly Attachment[] }) {
  const { t } = useI18n();
  const active = attachments.filter((a) => a.status === 'active');
  const removed = attachments.filter((a) => a.status === 'removed');
  return (
    <div className="flex flex-col gap-2" data-testid="source-list">
      {active.length === 0 && <p className="text-sm text-slate-600">{t('source.none')}</p>}
      {active.map((a) => (
        <a key={a.id} href={`#/cases/${caseId}/sources/${a.id}`} className="surface flex items-center gap-3 p-3 hover:shadow-lift" data-testid="source-row" data-kind={a.kind}>
          <SourceThumb a={a} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-slate-900">
              {t(`source.docType.${a.docType}`)}
              {a.page !== undefined && <span className="ms-1 text-sm font-normal text-slate-600">· {t('source.page', { n: a.page })}</span>}
            </span>
            <span className="truncate text-xs text-slate-600">
              {a.title ? `${a.title} · ` : ''}
              {a.hospitalDay !== undefined ? <DayLabel day={a.hospitalDay} /> : t('source.noDay')} · {t(`source.origin.${a.origin}`)}
            </span>
          </span>
          <Icon name="chevron-forward" className="h-5 w-5 text-slate-400" />
        </a>
      ))}
      {removed.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-touch cursor-pointer py-2 text-slate-700">{t('source.removedN', { n: removed.length })}</summary>
          <ul className="flex flex-col gap-1 text-slate-600">
            {removed.map((a) => (
              <li key={a.id}>
                <a href={`#/cases/${caseId}/sources/${a.id}`} className="line-through">
                  {t(`source.docType.${a.docType}`)}
                </a>{' '}
                — {a.removedReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
