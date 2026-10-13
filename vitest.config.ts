import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    // PBKDF2 at production strength is deliberately slow.
    testTimeout: 30_000,
  },
});
