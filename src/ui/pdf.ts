/**
 * Local PDF reading with pdf.js (Apache-2.0), loaded only when a PDF is added.
 * Pages are rendered on the device, then go through the same redaction step
 * as photographs; nothing leaves the device. Evaluation of PDF functions is
 * disabled (the Content-Security-Policy forbids eval anyway).
 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText, TextPiece } from '../library/chunk';

export const MAX_PDF_PAGES = 20;
const MAX_SIDE = 2000;

export interface LoadedPdf {
  pages: number;
  renderPage: (n: number) => Promise<HTMLCanvasElement>;
  /** The embedded text layer (empty for scanned documents). */
  text: () => Promise<string>;
  /** M5: the text layer of every page with each piece's position and size, for chunking a guideline (library/chunk.ts). */
  textPages: (maxPages?: number) => Promise<PageText[]>;
  /** M5: what the file says about itself (title, author, year), offered to the trainee to confirm — never filled in by a model. */
  info: () => Promise<{ title?: string; author?: string; year?: number }>;
  destroy: () => void;
}

export async function loadPdf(file: File): Promise<LoadedPdf> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise;
  return {
    pages: doc.numPages,
    async renderPage(n) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      return canvas;
    },
    async text() {
      const parts: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let line = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          line += item.str;
          if (item.hasEOL) {
            parts.push(line);
            line = '';
          } else line += ' ';
        }
        if (line.trim()) parts.push(line);
        parts.push('');
      }
      return parts
        .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    },
    async textPages(maxPages = doc.numPages) {
      const out: PageText[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const page = await doc.getPage(i);
        const height = page.getViewport({ scale: 1 }).height;
        const content = await page.getTextContent();
        const pieces: TextPiece[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str) continue;
          const [, , c, d, e, f] = item.transform as number[];
          const size = Math.hypot(c ?? 0, d ?? 0) || item.height || 10;
          // pdf.js measures y from the bottom of the page, at the baseline; the chunker reads top-down.
          pieces.push({ str: item.str, x: e ?? 0, y: height - (f ?? 0), width: item.width ?? item.str.length * size * 0.5, size });
        }
        out.push({ page: i, height, pieces });
        page.cleanup();
      }
      return out;
    },
    async info() {
      try {
        const meta = await doc.getMetadata();
        const i = (meta.info ?? {}) as { Title?: string; Author?: string; CreationDate?: string };
        const year = /^D:(\d{4})/.exec(i.CreationDate ?? '')?.[1];
        return { ...(i.Title?.trim() ? { title: i.Title.trim() } : {}), ...(i.Author?.trim() ? { author: i.Author.trim() } : {}), ...(year ? { year: Number(year) } : {}) };
      } catch {
        return {};
      }
    },
    destroy() {
      void doc.destroy();
    },
  };
}
