import { defineConfig } from 'vitest/config';
import { calcValidationPlugin } from './scripts/calc-validation';

export default defineConfig({
  plugins: [calcValidationPlugin()],
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/calc/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    // Writes src/calc/validation-manifest.json after a run that covered every calculator test file.
    reporters: ['default', './scripts/calc-manifest-reporter.ts'],
    // PBKDF2 at production strength is deliberately slow.
    testTimeout: 30_000,
  },
});
