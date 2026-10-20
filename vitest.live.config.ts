/**
 * Live runs against the real model service (opt-in, synthetic data only).
 * Never part of `npm test`: they need the network, a key added by the
 * environment and the provider's quota, and they cost money on a paid key.
 *
 *   npx vitest run --config vitest.live.config.ts
 */
import { defineConfig } from 'vitest/config';
import { calcValidationPlugin } from './scripts/calc-validation';
import { datasetsPlugin } from './scripts/datasets-plugin';

export default defineConfig({
  plugins: [calcValidationPlugin(), datasetsPlugin()],
  test: {
    include: ['tests/live/**/*.live.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
  },
});
