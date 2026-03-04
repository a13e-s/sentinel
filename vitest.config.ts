import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    exclude: ['**/node_modules/**', '**/repos/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/temporal/workflows.ts'],
      lines: 70,
      functions: 70,
      branches: 60,
      statements: 70,
    },
  },
});
