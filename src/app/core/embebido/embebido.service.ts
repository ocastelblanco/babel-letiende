import { Injectable, PLATFORM_ID, REQUEST, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * `true` cuando la app se sirve embebida a través del proxy de letiende.co
 * (Host `letiende.co` o `staging.letiende.co`), `false` cuando se sirve
 * directo por su propio dominio (`babel.letiende.co`, `localhost`). Función
 * pura y testeable, mismo patrón ya validado en el proyecto hermano Ágora
 * (`src/app/core/embebido/embebido.service.ts` de ese repo, T-0013).
 */
export function esEmbebido(hostname: string): boolean {
  return hostname === 'letiende.co' || hostname === 'staging.letiende.co';
}

/**
 * Copia del criterio de letiende.co (ADR-024, `core/carta-visibilidad.ts`
 * de ese repo): `/carta` responde 404 en producción mientras la carta no
 * esté publicada. Publicada el 19/10/2026 (T-0040 de letiende.co): la
 * constante es `true` aquí, en letiende.co y en Ágora.
 */
export const CARTA_PUBLICADA = true;

/** `true` si el enlace "Carta" debe mostrarse: carta publicada, o host de staging/desarrollo. */
export function cartaVisibleEnHost(hostname: string, publicada: boolean = CARTA_PUBLICADA): boolean {
  return publicada || ['staging.letiende.co', 'localhost', '127.0.0.1'].includes(hostname);
}

@Injectable({ providedIn: 'root' })
export class EmbebidoService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly request = inject(REQUEST, { optional: true });

  /**
   * Se calcula una sola vez por instancia (una instancia por petición en
   * SSR, dado que `providedIn: 'root'` crea un injector nuevo por render
   * del lado servidor). En el navegador usa `window.location.hostname`
   * (autoritativo); en SSR usa el header `x-le-tiende-host` — el `Host`
   * real del visitante NUNCA llega aquí (la política
   * `AllViewerExceptHostHeader` de CloudFront lo despoja, obligatoria para
   * que API Gateway no rechace con 403); el contenedor letiende.co copia
   * el Host real a este header propio con una CloudFront Function antes
   * de reenviar (`FuncionInyectarHostVisitante`, repo letiende.co) — ese
   * es el que hay que leer. `null`/vacío en rutas prerenderizadas (SSG),
   * durante el build, o si se accede fuera del proxy (directo por
   * `babel.letiende.co`, sin esa CloudFront Function delante) — en ese
   * caso se asume `false` (comportamiento actual sin cambios, el más
   * seguro por defecto) y el navegador lo corrige en el primer bootstrap
   * del lado cliente.
   */
  readonly embebido: boolean;

  /** Visibilidad del enlace "Carta" en el menú embebido; mismo hostname que `embebido`. */
  readonly cartaVisible: boolean;

  constructor() {
    const hostname = this.obtenerHostname();
    this.embebido = esEmbebido(hostname);
    this.cartaVisible = cartaVisibleEnHost(hostname);
  }

  private obtenerHostname(): string {
    if (isPlatformBrowser(this.platformId)) {
      return window.location.hostname;
    }
    const host = this.request?.headers.get('x-le-tiende-host') ?? '';
    return host.split(':')[0];
  }
}
