// Wrapper de Lambda para el SSR de Angular.
//
// `src/server.ts` (compilado por Angular CLI a `dist/babel-letiende/server/server.mjs`)
// exporta una instancia de Express (`app`) pensada para correr con `app.listen()`
// en un servidor Node.js standalone. AWS Lambda necesita en cambio una función
// `(event, context) => response`, así que aquí se envuelve esa misma instancia
// de Express con `@codegenie/serverless-express` sin duplicar el bootstrap del
// motor de renderizado.
//
// Este archivo se mantiene en JavaScript plano (no TypeScript) porque solo
// existe una vez que `npm run build` generó `dist/babel-letiende/server/server.mjs`;
// compilarlo con tsc introduciría una dependencia circular con ese artefacto de build.
import serverlessExpress from '@codegenie/serverless-express';
import { app } from '../../dist/babel-letiende/server/server.mjs';

export const handler = serverlessExpress({ app });
