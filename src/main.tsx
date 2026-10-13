import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Session } from './store/session';
import { PreceptorDB } from './store/db';
import { App } from './ui/App';
import { initPwa } from './ui/pwa';

const session = new Session(new PreceptorDB('preceptor'));
// Preview builds run inside a host frame where service workers are not available.
if (!import.meta.env.VITE_PREVIEW_BUILD) initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
