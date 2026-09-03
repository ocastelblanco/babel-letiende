import { HttpInterceptorFn } from '@angular/common/http';
import { REQUEST, inject } from '@angular/core';
import { EmbebidoService } from '../embebido/embebido.service';

/**
 * En el navegador, una URL relativa (`/api/...`) la resuelve el propio
 * navegador contra el origen actual. En SSR (Lambda `ssr`), el `fetch` de
 * Node no tiene noción de "origen actual" y una URL relativa revienta la
 * petición (silenciosamente, dejando la app sin estabilizar — ver
 * `MEMORY.md` §7). Se usa el token `REQUEST` (la petición HTTP entrante que
 * Angular expone durante SSR) para anteponer ese mismo origen, ya que `ssr`
 * y `api` comparten dominio (ver ADR-008). Esa parte SSR no necesita el
 * prefijo del proxy de abajo: es una llamada Lambda-a-Lambda directa contra
 * el propio `execute-api`, nunca pasa por CloudFront.
 *
 * **Segundo caso, en el navegador, hallazgo real (T-0014):** cuando la app
 * se sirve embebida a través del proxy de letiende.co, `/api/...` (ruta
 * absoluta) la resuelve el navegador contra el ORIGEN de la página
 * (`staging.letiende.co`), ignorando por completo el `<base href>` — una
 * ruta absoluta nunca hereda el prefijo del `baseHref`, a diferencia de una
 * ruta relativa. Sin prefijo, CloudFront enruta esa petición al
 * comportamiento por defecto (el contenedor `letiende.co`, que no tiene esa
 * ruta) en vez de a esta app — verificado en vivo con curl real
 * (`staging.letiende.co/api/libros` → 404 del contenedor). Se le antepone
 * `/libros` a mano; la CloudFront Function del contenedor
 * (`FuncionInyectarHostVisitante`) ya quita ese mismo prefijo antes de
 * reenviar a esta app, así que su propio API Gateway sigue viendo
 * `/api/...` sin prefijo, sin cambios.
 */
export const absoluteUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const peticionEntrante = inject(REQUEST, { optional: true });

  if (!req.url.startsWith('/')) {
    return next(req);
  }

  if (peticionEntrante) {
    const origen = new URL(peticionEntrante.url).origin;
    return next(req.clone({ url: `${origen}${req.url}` }));
  }

  const embebido = inject(EmbebidoService).embebido;
  if (embebido && req.url.startsWith('/api/')) {
    return next(req.clone({ url: `/libros${req.url}` }));
  }

  return next(req);
};
