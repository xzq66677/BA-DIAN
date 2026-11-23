import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    env: mode === 'in-process' ? { BADIAN_IN_PROCESS_TEST: '1' } : undefined,
  },
}));
