import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { calcValidationPlugin } from './scripts/calc-validation';
import { datasetsPlugin } from './scripts/datasets-plugin';

/**
 * Content-Security-Policy for the production build.
 *
 * `connect-src` is a browser-enforced list of the only places this app can
 * send anything: its own origin (which includes the model relay, a
 * serverless function on the same site) and, from M3, the NIH RxNav service
 * for drug-name matching (Section 4, only the drug name is sent). Nothing
 * else — in particular no model provider — is reachable from the browser.
 *
 * Applied only to `vite build`, because the dev server relies on inline
 * scripts for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://rxnav.nlm.nih.gov",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'preceptor-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cspMeta(),
    calcValidationPlugin(),
    datasetsPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        id: '/',
        name: 'PRECEPTOR — clinical pharmacy rotation copilot (educational)',
        short_name: 'PRECEPTOR',
        description:
          'Educational tool for supervised clinical pharmacy trainees. Not intended for diagnosis, treatment, or patient-care decisions.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f5f0',
        theme_color: '#0b2e2f',
        lang: 'en',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // json: the offline datasets (public/data), each checked against its SHA-256 before use.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,webmanifest,woff2,json}'],
        // The PDF renderer's worker (used only when a PDF is added) is about 1.4 MB.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // No runtime caching: PRECEPTOR makes no network requests beyond its own shell.
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Libraries change rarely: in their own chunks, an app update re-downloads only the app code.
        manualChunks: {
          react: ['react', 'react-dom'],
          dexie: ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
});
