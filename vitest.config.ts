import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], pool: 'forks', maxWorkers: 2, minWorkers: 1, testTimeout: 30000 },
});
