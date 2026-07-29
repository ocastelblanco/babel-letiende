import { defineConfig } from 'vitest/config';

/**
 * Config propia y aislada de esta herramienta — NO debe heredar ni mezclarse
 * con `vitest.config.ts` de la raíz del repo (que apunta a `server/**`).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    root: import.meta.dirname,
  },
});
