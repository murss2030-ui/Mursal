// Turns the preview build (dist-preview/) into a page for a hosted preview frame that supplies
// its own <html>/<head>/<body> skeleton: only the title, stylesheet, mount point and script remain.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-preview/index.html', 'utf8');
const js = /<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
const css = /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)"/.exec(html)?.[1];
if (!js || !css) throw new Error('Could not find the built script and stylesheet in dist-preview/index.html');

writeFileSync(
  'dist-preview/preceptor-preview.html',
  `<title>PRECEPTOR</title>
<style>body{font-size:16px;background:#f8fafc}</style>
<link rel="stylesheet" href="${css}">
<div id="root"></div>
<noscript>PRECEPTOR requires JavaScript.</noscript>
<script type="module" src="${js}"></script>
`,
);
console.log(JSON.stringify({ page: 'dist-preview/preceptor-preview.html', js, css }));
