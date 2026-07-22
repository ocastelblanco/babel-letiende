import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SitioScraping } from '../models/sitio-scraping.model';

/** Datos editables de un sitio de scraping — sin `dominio`, que va en la URL y no se puede cambiar tras crearlo (mismo contrato que `PUT /api/sitios-scraping/{dominio}`). */
export interface DatosSitioScraping {
  nombre: string;
  url: string;
  info: boolean;
  pvp: boolean;
  prioridad: number;
}

/**
 * Resultado de una operación de escritura (`crearSitio`/`actualizarSitio`/`eliminarSitio`):
 * a diferencia de `cargarSitios()`, estas operaciones nunca lanzan pero sí
 * necesitan devolver un mensaje de error específico para mostrarlo en la UI
 * (`GestionSitiosScrapingComponent`).
 */
export type ResultadoOperacionSitioScraping = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `/api/sitios-scraping` (`plan-obtencion-info-libros.md` §6 Task A,
 * ADR-010) — mismo patrón que `EstantesService`: peticiones autenticadas con
 * el ID Token actual. `crearSitio` recibe el objeto completo, incluido
 * `dominio` (la clave primaria, suministrada por el administrador, no la
 * genera el backend) — a diferencia de `actualizarSitio`, que recibe el
 * `dominio` por separado porque va en la URL. Todas las operaciones son
 * exclusivas de `administrador` en el backend (`CLAUDE.md` A01); este
 * servicio nunca decide por sí mismo si el usuario puede escribir.
 */
@Injectable({ providedIn: 'root' })
export class SitiosScrapingService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly sitiosSignal = signal<SitioScraping[]>([]);
  /** Último listado resuelto por `cargarSitios()`. */
  readonly sitios = this.sitiosSignal.asReadonly();

  private readonly errorSignal = signal(false);
  /** `true` si la última llamada a `cargarSitios()` falló. */
  readonly error = this.errorSignal.asReadonly();

  /**
   * Llama `GET /api/sitios-scraping` con el ID Token actual. Nunca lanza:
   * ante cualquier caso sin autorización (sin sesión, `401`, `403`, error de
   * red) deja `sitios` en `[]` y marca `error` en `true`.
   */
  async cargarSitios(): Promise<void> {
    this.errorSignal.set(false);

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      this.sitiosSignal.set([]);
      this.errorSignal.set(true);
      return;
    }

    try {
      const sitios = await firstValueFrom(
        this.http.get<SitioScraping[]>('/api/sitios-scraping', {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      this.sitiosSignal.set(sitios);
    } catch {
      this.sitiosSignal.set([]);
      this.errorSignal.set(true);
    }
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `EstantesService`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }

  /**
   * Llama `POST /api/sitios-scraping` con el ID Token actual. Nunca lanza:
   * devuelve `{ exito: false, error }` ante sesión ausente, `403` (rol
   * insuficiente, `CLAUDE.md` A01), `409` (dominio ya registrado) o error de
   * red. Tras un `201` exitoso, recarga `sitios` con `cargarSitios()`.
   */
  async crearSitio(datos: SitioScraping): Promise<ResultadoOperacionSitioScraping> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear el sitio de scraping. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.post<SitioScraping>('/api/sitios-scraping', datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarSitios();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo crear el sitio de scraping. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `PUT /api/sitios-scraping/{dominio}` con el ID Token actual. Nunca
   * lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`,
   * `404` (dominio inexistente) o error de red. Tras un `200` exitoso,
   * recarga `sitios` con `cargarSitios()`.
   */
  async actualizarSitio(dominio: string, datos: DatosSitioScraping): Promise<ResultadoOperacionSitioScraping> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar el sitio de scraping. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.put<SitioScraping>(`/api/sitios-scraping/${dominio}`, datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarSitios();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo actualizar el sitio de scraping. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `DELETE /api/sitios-scraping/{dominio}` con el ID Token actual.
   * Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente,
   * `403`, `404` o error de red. Tras un `204` exitoso, recarga `sitios` con
   * `cargarSitios()`.
   */
  async eliminarSitio(dominio: string): Promise<ResultadoOperacionSitioScraping> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el sitio de scraping. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.delete<void>(`/api/sitios-scraping/${dominio}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarSitios();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo eliminar el sitio de scraping. Intenta de nuevo.'),
      };
    }
  }
}
