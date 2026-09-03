import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Redirección 301 desde el dominio antiguo (`babel.letiende.co`).
 *
 * El build usa `baseHref: /libros/` (para que el proxy de letiende.co
 * funcione), lo que significa que el Router de Angular del lado cliente
 * exige que la URL real del navegador ya empiece con `/libros`. Dos ramas,
 * según el valor SEO de la ruta — mismo patrón ya verificado en Ágora:
 *
 * 1. `/` y `/libro/:bookId` (rutas públicas con valor de SEO/contenido) →
 *    301 CROSS-DOMAIN a `letiende.co/libros/...`. Consolida el SEO.
 * 2. Cualquier otra ruta (login, catalogar, admin, etc.) que no venga ya
 *    con el prefijo `/libros` → 301 MISMO DOMINIO a
 *    `babel.letiende.co/libros/...`. El staff sigue entrando por el
 *    dominio de siempre; solo se le antepone el prefijo obligatorio.
 *
 * La condición `!req.path.startsWith('/libros')` evita el bucle: la
 * segunda petición (ya con el prefijo) cae al `next()` final.
 */
const HOST_ANTIGUO = 'babel.letiende.co';
const RUTA_DETALLE_LIBRO = /^\/libro\/[^/]+$/;
const PREFIJO_LIBROS = '/libros';

app.use((req, res, next) => {
  if (req.hostname !== HOST_ANTIGUO) {
    next();
    return;
  }
  const esRaiz = req.path === '/';
  const esDetalleLibro = RUTA_DETALLE_LIBRO.test(req.path);
  if (esRaiz || esDetalleLibro) {
    res.redirect(301, `https://letiende.co${PREFIJO_LIBROS}${req.originalUrl}`);
    return;
  }
  if (!req.path.startsWith(PREFIJO_LIBROS)) {
    res.redirect(301, `https://babel.letiende.co${PREFIJO_LIBROS}${req.originalUrl}`);
    return;
  }
  next();
});

/**
 * Serve static files from /browser.
 *
 * El build genera los archivos en una carpeta plana (sin subcarpeta
 * `libros/`), pero con `baseHref: /libros/` el HTML servido le pide al
 * navegador los assets bajo ese prefijo. Por eso se monta el estático dos
 * veces: bajo `/libros` (lo que el navegador realmente pide) y en la raíz
 * (compatibilidad, por si algo pide la ruta sin prefijo) — mismo patrón ya
 * verificado en Ágora.
 */
const opcionesEstatico = {
  maxAge: '1y',
  index: false,
  redirect: false,
};
app.use(PREFIJO_LIBROS, express.static(browserDistFolder, opcionesEstatico));
app.use(express.static(browserDistFolder, opcionesEstatico));

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

/**
 * Instancia de Express expuesta para que el wrapper de AWS Lambda
 * (`server/ssr/handler.mjs`, vía `@codegenie/serverless-express`) pueda
 * envolverla sin duplicar el bootstrap del motor SSR de Angular.
 */
export { app };
