/**
 * Minimal hash router. Hash routes need no server rewrites, survive a reload,
 * and work offline from the precached app shell — so a form left open when
 * the app locks is still there after unlocking.
 */
import { useEffect, useState } from 'react';

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h === '' ? '/' : h;
}

export function useHashLocation(): { path: string; query: URLSearchParams } {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const on = () => setLoc(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [path, qs] = loc.split('?') as [string, string | undefined];
  return { path, query: new URLSearchParams(qs ?? '') };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = `#${to}`;
  if (opts.replace) window.location.replace(target);
  else window.location.hash = to;
}

/** Matches '/cases/:id/:tab' style patterns. Returns the params, or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(s[i]!);
    else if (seg !== s[i]) return null;
  }
  return params;
}
