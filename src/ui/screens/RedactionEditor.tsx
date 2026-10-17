/**
 * Redaction before storage (Section 13). The trainee covers every identifier
 * with boxes or a brush; the cover is burned into the pixels of the copy that
 * is saved. The original photograph is never stored, its EXIF metadata
 * (including any location) is dropped by re-encoding, and nothing can be saved
 * until the trainee confirms that all identifiers are removed.
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { SourceDocType } from '../../domain/types';
import { SOURCE_DOC_TYPES } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { Icon, type IconName } from '../components/Icon';
import { Button, CheckboxField, SelectField, TextField } from '../components/ui';

const MAX_SIDE = 2000;
const THUMB_SIDE = 320;

type Shape = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'brush'; size: number; pts: [number, number][] };
type Tool = 'move' | 'box' | 'brush';

export interface RedactedPage {
  bytes: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
  docType: SourceDocType;
  hospitalDay?: number;
  title?: string;
}

export type PageSource = { kind: 'file'; file: File } | { kind: 'canvas'; canvas: HTMLCanvasElement; name: string };

async function toBase(src: PageSource): Promise<HTMLCanvasElement> {
  let w: number;
  let h: number;
  let draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  if (src.kind === 'file') {
    // Applies the photo's EXIF orientation; the EXIF data itself is not carried over.
    const bmp = await createImageBitmap(src.file, { imageOrientation: 'from-image' });
    w = bmp.width;
    h = bmp.height;
    draw = (ctx, cw, ch) => ctx.drawImage(bmp, 0, 0, cw, ch);
  } else {
    w = src.canvas.width;
    h = src.canvas.height;
    draw = (ctx, cw, ch) => ctx.drawImage(src.canvas, 0, 0, cw, ch);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  draw(ctx, c.width, c.height);
  return c;
}

function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return c;
}

function paint(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, shapes: readonly Shape[], preview?: Shape): void {
  ctx.drawImage(base, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of preview ? [...shapes, preview] : shapes) {
    if (s.kind === 'rect') ctx.fillRect(s.x, s.y, s.w, s.h);
    else {
      ctx.lineWidth = s.size;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      if (s.pts.length === 1) ctx.lineTo(s.pts[0]![0] + 0.1, s.pts[0]![1]);
      ctx.stroke();
    }
  }
}

function normRect(x0: number, y0: number, x1: number, y1: number): Shape {
  return { kind: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

async function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not encode the image.');
  return new Uint8Array(await blob.arrayBuffer());
}

export function RedactionEditor({
  source,
  index,
  total,
  defaultDocType,
  todayDay,
  onSave,
  onSkip,
  onCancel,
}: {
  source: PageSource;
  index: number;
  total: number;
  defaultDocType: SourceDocType | '';
  todayDay: number | null;
  onSave: (p: RedactedPage) => Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState<string>();
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [preview, setPreview] = useState<Shape>();
  const [tool, setTool] = useState<Tool>('box');
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');
  const [zoom, setZoom] = useState(1);
  const [docType, setDocType] = useState<string>(defaultDocType);
  const [day, setDay] = useState('');
  const [title, setTitle] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const drag = useRef<{ x0: number; y0: number; brush?: [number, number][] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBase(null);
    setShapes([]);
    setConfirmed(false);
    setFailed(undefined);
    toBase(source)
      .then((c) => !cancelled && setBase(c))
      .catch(() => !cancelled && setFailed(t('redact.unreadable')));
    return () => {
      cancelled = true;
    };
  }, [source, t]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !base) return;
    c.width = base.width;
    c.height = base.height;
    paint(c.getContext('2d')!, base, shapes, preview);
  }, [base, shapes, preview]);

  const toImage = (e: RPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * e.currentTarget.width) / r.width, ((e.clientY - r.top) * e.currentTarget.height) / r.height];
  };
  const brushSize = base ? Math.round(Math.min(base.width, base.height) * { s: 0.015, m: 0.03, l: 0.06 }[size]) : 10;

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'move' || !base) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toImage(e);
    drag.current = { x0: x, y0: y, ...(tool === 'brush' ? { brush: [[x, y]] } : {}) };
    setPreview(tool === 'brush' ? { kind: 'brush', size: brushSize, pts: [[x, y]] } : normRect(x, y, x, y));
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toImage(e);
    if (d.brush) {
      d.brush.push([x, y]);
      setPreview({ kind: 'brush', size: brushSize, pts: [...d.brush] });
    } else setPreview(normRect(d.x0, d.y0, x, y));
  };
  const up = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const [x, y] = toImage(e);
    const shape: Shape = d.brush ? { kind: 'brush', size: brushSize, pts: [...d.brush, [x, y]] } : normRect(d.x0, d.y0, x, y);
    setPreview(undefined);
    if (shape.kind === 'rect' && (shape.w < 4 || shape.h < 4)) return;
    setShapes((s) => [...s, shape]);
    setConfirmed(false);
  };

  const save = async () => {
    if (!base || !canvasRef.current) return;
    if (!docType) {
      setError(t('redact.chooseType'));
      return;
    }
    const dayNum = day.trim() === '' ? undefined : Number(day);
    if (dayNum !== undefined && !Number.isInteger(dayNum)) {
      setError(t('err.hospitalDay'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // The saved image is drawn fresh from the base plus every shape: the redaction is part of the pixels.
      const out = document.createElement('canvas');
      out.width = base.width;
      out.height = base.height;
      paint(out.getContext('2d')!, base, shapes);
      const tScale = Math.min(1, THUMB_SIDE / Math.max(out.width, out.height));
      const th = document.createElement('canvas');
      th.width = Math.max(1, Math.round(out.width * tScale));
      th.height = Math.max(1, Math.round(out.height * tScale));
      th.getContext('2d')!.drawImage(out, 0, 0, th.width, th.height);
      await onSave({
        bytes: await jpeg(out, 0.85),
        thumb: await jpeg(th, 0.7),
        width: out.width,
        height: out.height,
        docType: docType as SourceDocType,
        hospitalDay: dayNum,
        title: title.trim() || undefined,
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const tools: { id: Tool; icon: IconName; label: string }[] = [
    { id: 'move', icon: 'hand', label: t('redact.move') },
    { id: 'box', icon: 'square', label: t('redact.box') },
    { id: 'brush', icon: 'brush', label: t('redact.brush') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-white" role="dialog" aria-modal="true" aria-labelledby="redact-title" data-testid="redaction-editor">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex flex-col">
          <h2 id="redact-title" className="text-base font-semibold">
            {t('redact.title')}
          </h2>
          <span className="text-xs text-teal-100">{t('redact.page', { i: index + 1, n: total })}</span>
        </div>
        <button type="button" onClick={onCancel} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg hover:bg-white/10" aria-label={t('redact.cancelAll')}>
          <Icon name="x" className="h-6 w-6" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2" role="toolbar" aria-label={t('redact.tools')}>
        {tools.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={tool === x.id}
            onClick={() => setTool(x.id)}
            className={`inline-flex min-h-[40px] items-center gap-1 rounded-full px-3 text-sm font-medium ${tool === x.id ? 'bg-saffron-400 text-ink' : 'bg-white/10 text-white hover:bg-white/20'}`}
            data-testid={`tool-${x.id}`}
          >
            <Icon name={x.icon} className="h-4 w-4" />
            {x.label}
          </button>
        ))}
        {tool === 'brush' && (
          <span className="inline-flex gap-1">
            {(['s', 'm', 'l'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                onClick={() => setSize(s)}
                className={`min-h-[40px] rounded-full px-3 text-sm ${size === s ? 'bg-white text-ink' : 'bg-white/10'}`}
                aria-label={t(`redact.size.${s}`)}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </span>
        )}
        <span className="mx-1 h-6 w-px bg-white/20" aria-hidden="true" />
        <button type="button" onClick={() => setZoom((z) => (z >= 3 ? 1 : z + 1))} className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-white/10 px-3 text-sm hover:bg-white/20">
          <Icon name="zoom-in" className="h-4 w-4" />
          {zoom}×
        </button>
        <button
          type="button"
          onClick={() => base && setBase(rotate90(base))}
          disabled={shapes.length > 0}
          title={shapes.length > 0 ? t('redact.rotateFirst') : undefined}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-white/10 px-3 text-sm hover:bg-white/20 disabled:opacity-40"
        >
          <Icon name="rotate" className="h-4 w-4" />
          {t('redact.rotate')}
        </button>
        <button type="button" onClick={() => setShapes((s) => s.slice(0, -1))} disabled={!shapes.length} className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-white/10 px-3 text-sm hover:bg-white/20 disabled:opacity-40">
          <Icon name="undo" className="h-4 w-4" />
          {t('redact.undo')}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-black/40 p-2">
        {failed ? (
          <p className="p-4 text-sm">{failed}</p>
        ) : !base ? (
          <p className="p-4 text-sm text-teal-100">{t('redact.loading')}</p>
        ) : (
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              drag.current = null;
              setPreview(undefined);
            }}
            style={{ width: `${zoom * 100}%`, touchAction: tool === 'move' ? 'auto' : 'none', cursor: tool === 'move' ? 'grab' : 'crosshair' }}
            className="mx-auto block max-w-none select-none bg-white"
            data-testid="redaction-canvas"
            aria-label={t('redact.canvas')}
          />
        )}
      </div>

      <div className="max-h-[45vh] overflow-y-auto border-t border-white/10 bg-white px-3 py-3 text-slate-900">
        <div className="mx-auto flex max-w-screen-md flex-col gap-3">
          <p className="text-xs text-slate-700">{t('redact.help', { n: shapes.length })}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SelectField
              label={t('source.docType')}
              name="docType"
              value={docType}
              onChange={setDocType}
              options={SOURCE_DOC_TYPES.map((d) => ({ value: d, label: t(`source.docType.${d}`) }))}
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextField label={t('source.hospitalDay')} hint={t('source.hospitalDayHint')} optional inputMode="numeric" value={day} onChange={setDay} name="sourceDay" />
              </div>
              {todayDay !== null && day === '' && (
                <Button className="mb-[2px]" onClick={() => setDay(String(todayDay))}>
                  {t('ed.today', { d: todayDay })}
                </Button>
              )}
            </div>
            <TextField label={t('source.title')} optional value={title} onChange={setTitle} name="sourceTitle" />
          </div>
          <CheckboxField label={t('redact.confirm')} checked={confirmed} onChange={setConfirmed} name="redactionConfirmed" />
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={save} disabled={!confirmed || !base || busy} icon="check">
              {busy ? t('common.saving') : t('redact.save')}
            </Button>
            <Button variant="ghost" onClick={onSkip} disabled={busy}>
              {total > 1 ? t('redact.skip') : t('common.cancel')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
