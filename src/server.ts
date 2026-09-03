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
 * exige que la URL real del navegador ya empiece con `/libros`. Toda ruta
 * que llegue por este dominio sin ese prefijo recibe un 301 MISMO DOMINIO
 * a `babel.letiende.co/libros/...` — el staff sigue entrando por el
 * dominio de siempre, solo se le antepone el prefijo obligatorio.
 *
 * **Incidente real de producción (03/09/2026), reportado en vivo por el
 * humano — mismo hallazgo, mismo fix ya aplicado primero en Ágora:** la
 * primera versión de este archivo (T-0014) redirigía `/` y
 * `/libro/:bookId` en una rama aparte, CROSS-DOMAIN a
 * `letiende.co/libros/...`, para consolidar el SEO en un solo dominio —
 * decisión explícita, correcta como diseño final. Pero el cutover real de
 * producción de `letiende.co` (T-14/T-15, todavía pendiente,
 * `docs/MEMORY.md` §5 de ese repositorio) no había ocurrido: el dominio
 * `letiende.co` en producción sigue sirviendo el sitio estático VIEJO
 * (`E33QAN86FY24JZ`), que no tiene ninguna ruta `/libros`. El resultado:
 * `babel.letiende.co` — el único acceso público real hoy, porque el
 * contenedor nuevo aún no está en el dominio raíz — quedaba roto. Mientras
 * el cutover no ocurra, **todas** las rutas de este dominio redirigen
 * mismo dominio con el prefijo, sin excepción — la rama cross-domain para
 * `/` y `/libro/:bookId` se restaura cuando T-14/T-15 esté hecho, no antes.
 *
 * La condición `!req.path.startsWith('/libros')` evita el bucle: la
 * segunda petición (ya con el prefijo) cae al `next()` final.
 */
const HOST_ANTIGUO = 'babel.letiende.co';
const PREFIJO_LIBROS = '/libros';

app.use((req, res, next) => {
  if (req.hostname !== HOST_ANTIGUO || req.path.startsWith(PREFIJO_LIBROS)) {
    next();
    return;
  }
  res.redirect(301, `https://babel.letiende.co${PREFIJO_LIBROS}${req.originalUrl}`);
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
