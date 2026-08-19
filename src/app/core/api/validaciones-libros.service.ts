import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ResumenValidacionLibros } from '../models/validacion-libros.model';

/**
 * Resultado de `iniciarValidacion()` (`POST /api/validaciones-libros`,
 * `docs/plan-validar-libros-async.md` §4.1). Nunca lanza. El caso `409`
 * (ya hay una corrida `en_progreso`) NO se trata como un error de UI: el
 * backend devuelve el `validacionId` de esa corrida para que
 * `ValidarLibrosComponent` retome su polling en vez de solo mostrar un
 * mensaje de error — por eso el discriminante es `iniciada`, no `exito`.
 */
export type ResultadoIniciarValidacion =
  | { iniciada: true; validacionId: string }
  | { iniciada: false; validacionIdEnCurso: string; error: string }
  | { iniciada: false; validacionIdEnCurso: null; error: string };

/**
 * Cliente de `/api/validaciones-libros` (ADR-012, `docs/plan-validar-libros-async.md`) —
 * mismo patrón de autenticación que `SitiosScrapingService`: peticiones con
 * el ID Token actual, exclusivas de `administrador` en el backend
 * (`CLAUDE.md` A01). Este servicio nunca decide por sí mismo si el usuario
 * puede escribir.
 *
 * `ultimoValidacionId` (Signal, en memoria — no sobrevive un recargo de
 * página) permite que `ValidarLibrosComponent` retome el polling si el
 * administrador navega fuera de `/admin/validar-libros` y vuelve dentro de
 * la misma sesión de la SPA. Tras un recargo real de página, el mecanismo de
 * respaldo es el `409` de `iniciarValidacion()`: si ya hay una corrida
 * activa en el backend, el administrador la retoma con solo hacer clic en
 * "Iniciar validación" de nuevo — no hay un endpoint "dame la última
 * corrida" (decisión ya tomada en el diseño, `plan-validar-libros-async.md` §4.3).
 */
@Injectable({ providedIn: 'root' })
export class ValidacionesLibrosService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly ultimoValidacionIdSignal = signal<string | null>(null);
  readonly ultimoValidacionId = this.ultimoValidacionIdSignal.asReadonly();

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `SitiosScrapingService`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }

  /**
   * Llama `POST /api/validaciones-libros`. Nunca lanza: ante sesión ausente,
   * `403` o error de red devuelve `{ iniciada: false, validacionIdEnCurso: null, error }`.
   * Ante `409` (ya hay una corrida activa), devuelve
   * `{ iniciada: false, validacionIdEnCurso, error }` — el llamador debe
   * tratar ese caso como "retomar", no como un fallo real.
   */
  async iniciarValidacion(): Promise<ResultadoIniciarValidacion> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { iniciada: false, validacionIdEnCurso: null, error: 'No se pudo iniciar la validación. Intenta de nuevo.' };
    }

    try {
      const respuesta = await firstValueFrom(
        this.http.post<{ validacionId: string }>(
          '/api/validaciones-libros',
          {},
          { headers: { Authorization: `Bearer ${idToken}` } },
        ),
      );
      this.ultimoValidacionIdSignal.set(respuesta.validacionId);
      return { iniciada: true, validacionId: respuesta.validacionId };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && typeof error.error?.validacionId === 'string') {
        this.ultimoValidacionIdSignal.set(error.error.validacionId);
        return {
          iniciada: false,
          validacionIdEnCurso: error.error.validacionId,
          error: this.mensajeError(error, 'Ya hay una validación en curso.'),
        };
      }
      return {
        iniciada: false,
        validacionIdEnCurso: null,
        error: this.mensajeError(error, 'No se pudo iniciar la validación. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `GET /api/validaciones-libros/:validacionId` (polling). Nunca
   * lanza: devuelve `null` ante sesión ausente, `403`, `404` o error de red
   * — `ValidarLibrosComponent` decide cómo reaccionar (ej. detener el
   * polling si la corrida ya no existe).
   */
  async consultarValidacion(validacionId: string): Promise<ResumenValidacionLibros | null> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return null;
    }

    try {
      return await firstValueFrom(
        this.http.get<ResumenValidacionLibros>(`/api/validaciones-libros/${validacionId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
    } catch {
      return null;
    }
  }
}
