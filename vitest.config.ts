import { defineConfig } from 'vitest/config';

/**
 * Config de Vitest para el backend (`server/**`), separada del test runner
 * de Angular (`ng test`, que usa su propia instancia de Vitest vía
 * `@angular/build:unit-test` y solo mira `src/**\/*.spec.ts` — no lee este
 * archivo salvo que se le pase `runnerConfig`, que no se usa). Se invoca con
 * `npm run test:api`.
 */
export default defineConfig({
  test: {
    include: ['server/**/*.spec.ts'],
    environment: 'node',
  },
});
