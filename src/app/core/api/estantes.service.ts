import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Estante } from '../models/estante.model';

/** Datos editables de un estante — sin `estanteId`, que resuelve el backend (mismo contrato que `POST`/`PUT /api/estantes`). */
export interface DatosEstante {
  espacio: string;
  mueble: string;
  ubicacion: string;
}

/**
 * Resultado de una operación de escritura (`crearEstante`/`actualizarEstante`/`eliminarEstante`):
 * a diferencia de `cargarEstantes()`, estas operaciones nunca lanzan pero sí
 * necesitan devolver un mensaje de error específico para mostrarlo en la UI
 * (`GestionEstantesComponent`).
 */
export type ResultadoOperacionEstante = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `/api/estantes` (tech-specs.md §5, "Admin") — mismo patrón que
 * `UsuariosService`: peticiones autenticadas con el ID Token actual.
 * `cargarEstantes()` (lectura, `vendedor` o `administrador`) se usa para
 * poblar el `<select>` de estante al catalogar un libro
 * (`CatalogarLibroComponent`). `crearEstante`/`actualizarEstante`/`eliminarEstante`
 * (escritura, exclusivas de `administrador` en el backend) las consume
 * `GestionEstantesComponent` — tras cada operación exitosa recargan
 * `estantes` llamando de nuevo a `cargarEstantes()`.
 */
@Injectable({ providedIn: 'root' })
export class EstantesService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly estantesSignal = signal<Estante[]>([]);
  /** Último listado resuelto por `cargarEstantes()`. */
  readonly estantes = this.estantesSignal.asReadonly();

  private readonly errorSignal = signal(false);
  /** `true` si la última llamada a `cargarEstantes()` falló. */
  readonly error = this.errorSignal.asReadonly();

  /**
   * Llama `GET /api/estantes` con el ID Token actual. Nunca lanza: ante
   * cualquier caso sin autorización (sin sesión, `401`, `403`, error de red)
   * deja `estantes` en `[]` y marca `error` en `true`.
   */
  async cargarEstantes(): Promise<void> {
    this.errorSignal.set(false);

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      this.estantesSignal.set([]);
      this.errorSignal.set(true);
      return;
    }

    try {
      const estantes = await firstValueFrom(
        this.http.get<Estante[]>('/api/estantes', {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      this.estantesSignal.set(estantes);
    } catch {
      this.estantesSignal.set([]);
      this.errorSignal.set(true);
    }
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `CatalogarLibroComponent`/`CambiarEstanteComponent`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }

  /**
   * Llama `POST /api/estantes` con el ID Token actual. Nunca lanza: devuelve
   * `{ exito: false, error }` ante sesión ausente, `403` (rol insuficiente,
   * `CLAUDE.md` A01) o error de red. Tras un `201` exitoso, recarga
   * `estantes` con `cargarEstantes()`.
   */
  async crearEstante(datos: DatosEstante): Promise<ResultadoOperacionEstante> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear el estante. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.post<Estante>('/api/estantes', datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarEstantes();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo crear el estante. Intenta de nuevo.') };
    }
  }

  /**
   * Llama `PUT /api/estantes/{estanteId}` con el ID Token actual. Nunca
   * lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`,
   * `404` (estante inexistente) o error de red. Tras un `200` exitoso,
   * recarga `estantes` con `cargarEstantes()`.
   */
  async actualizarEstante(estanteId: string, datos: DatosEstante): Promise<ResultadoOperacionEstante> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar el estante. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.put<Estante>(`/api/estantes/${estanteId}`, datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarEstantes();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo actualizar el estante. Intenta de nuevo.') };
    }
  }

  /**
   * Llama `DELETE /api/estantes/{estanteId}` con el ID Token actual. Nunca
   * lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`,
   * `404` o error de red. Tras un `204` exitoso, recarga `estantes` con
   * `cargarEstantes()`.
   */
  async eliminarEstante(estanteId: string): Promise<ResultadoOperacionEstante> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el estante. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.delete<void>(`/api/estantes/${estanteId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarEstantes();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo eliminar el estante. Intenta de nuevo.') };
    }
  }
}
