/**
 * Netlify Function entry point for the model relay (Section 6). All logic is
 * in relay/; this file only wires the environment, the usage store (Netlify
 * Blobs, counters only) and the provider. Configuration: see README, "AI service".
 */
import { getStore } from '@netlify/blobs';
import { readConfig, withUserKimiKey } from '../../relay/config';
import { handleModel, handleStatus } from '../../relay/handler';
import { geminiProvider } from '../../relay/providers/gemini';
import { kimiProvider } from '../../relay/providers/kimi';
import type { CounterStore } from '../../relay/usage';
import { KEY_HEADER, STATUS_PATH } from '../../src/ai/protocol';

function blobsStore(): CounterStore {
  const store = getStore({ name: 'preceptor-usage', consistency: 'strong' });
  return {
    async read<T>(key: string) {
      const r = await store.getWithMetadata(key, { type: 'json' });
      return r ? { value: r.data as T, etag: r.etag } : { value: null };
    },
    async write<T>(key: string, value: T, expected: { etag?: string }) {
      const r = expected.etag ? await store.setJSON(key, value, { onlyIfMatch: expected.etag }) : await store.setJSON(key, value, { onlyIfNew: true });
      return r.modified;
    },
  };
}

export default async (req: Request): Promise<Response> => {
  const read = readConfig(process.env);
  if (!read.ok) {
    return new Response(JSON.stringify({ error: { code: 'not_configured', message: read.problems.join(' ') } }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  const config = withUserKimiKey(read.config, req.headers.get(KEY_HEADER), process.env);
  const deps = { config, store: blobsStore(), provider: config.apiKey ? (config.provider === 'kimi' ? kimiProvider(config.apiKey) : geminiProvider(config.apiKey)) : undefined };
  return new URL(req.url).pathname === STATUS_PATH ? handleStatus(req, deps) : handleModel(req, deps);
};

export const config = { path: ['/api/model', '/api/status'] };
