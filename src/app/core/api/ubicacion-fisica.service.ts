import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Espacio } from '../models/espacio.model';
import { Mueble } from '../models/mueble.model';
import { Ubicacion } from '../models/ubicacion.model';

/** Datos editables de un espacio — sin `espacioId`, que resuelve el backend (mismo contrato que `POST`/`PUT /api/espacios`). */
export interface DatosEspacio {
  nombre: string;
}

/** Datos editables de un mueble — sin `muebleId`, que resuelve el backend (mismo contrato que `POST`/`PUT /api/muebles`). */
export interface DatosMueble {
  nombre: string;
  espacioId: string;
}

/** Datos editables de una ubicación — sin `ubicacionId`, que resuelve el backend (mismo contrato que `POST`/`PUT /api/ubicaciones`). */
export interface DatosUbicacion {
  nombre: string;
  muebleId: string;
}

/**
 * Resultado de una operación de escritura (crear/actualizar/eliminar): a
 * diferencia de `cargarX()`, estas operaciones nunca lanzan pero sí
 * necesitan devolver un mensaje de error específico para mostrarlo en la UI
 * (`GestionUbicacionFisicaComponent`) — mismo patrón que
 * `ResultadoOperacionEstante` en `estantes.service.ts`.
 */
export type ResultadoOperacionUbicacionFisica = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `/api/espacios`, `/api/muebles` y `/api/ubicaciones`
 * (`TODO.md` Tarea 2): 3 sub-APIs independientes, mismo patrón exacto que
 * `EstantesService` mutiplicado por 3 niveles de la jerarquía.
 *
 * Diferencia clave respecto a `EstantesService`: `cargarEspacios()`/
 * `cargarMuebles()`/`cargarUbicaciones()` (GET) son endpoints **públicos**
 * en el backend (sin token) — el catálogo público los usará en una tarea
 * futura para armar un filtro. Aun así, como este servicio se consume desde
 * `/admin/ubicaciones` (pantalla protegida), siguen resolviendo el ID Token
 * actual y enviándolo si está disponible (no daña nada mandarlo de más),
 * pero a diferencia de `EstantesService.cargarEstantes()` NUNCA se rechaza
 * de entrada por falta de token — la petición se hace igual, sin cabecera,
 * y el backend la resuelve como pública. Las operaciones de escritura
 * (`crear`/`actualizar`/`eliminar` de las 3 entidades) sí necesitan el
 * token: el backend exige `administrador` para `POST`/`PUT`/`DELETE`
 * (CLAUDE.md A01), así que si no hay sesión se devuelve el error sin
 * siquiera intentar la petición HTTP.
 */
@Injectable({ providedIn: 'root' })
export class UbicacionFisicaService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly espaciosSignal = signal<Espacio[]>([]);
  /** Último listado resuelto por `cargarEspacios()`. */
  readonly espacios = this.espaciosSignal.asReadonly();
  private readonly errorEspaciosSignal = signal(false);
  /** `true` si la última llamada a `cargarEspacios()` falló. */
  readonly errorEspacios = this.errorEspaciosSignal.asReadonly();

  private readonly mueblesSignal = signal<Mueble[]>([]);
  /** Último listado resuelto por `cargarMuebles()`. */
  readonly muebles = this.mueblesSignal.asReadonly();
  private readonly errorMueblesSignal = signal(false);
  /** `true` si la última llamada a `cargarMuebles()` falló. */
  readonly errorMuebles = this.errorMueblesSignal.asReadonly();

  private readonly ubicacionesSignal = signal<Ubicacion[]>([]);
  /** Último listado resuelto por `cargarUbicaciones()`. */
  readonly ubicaciones = this.ubicacionesSignal.asReadonly();
  private readonly errorUbicacionesSignal = signal(false);
  /** `true` si la última llamada a `cargarUbicaciones()` falló. */
  readonly errorUbicaciones = this.errorUbicacionesSignal.asReadonly();

  /** Cabeceras de autorización si hay una sesión activa, `undefined` si no (`GET` público no las necesita, `POST`/`PUT`/`DELETE` sí). */
  private cabeceras(idToken: string | null): { headers: HttpHeaders } | Record<string, never> {
    return idToken ? { headers: new HttpHeaders({ Authorization: `Bearer ${idToken}` }) } : {};
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `EstantesService`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }

  // ---------------------------------------------------------------------
  // Espacios
  // ---------------------------------------------------------------------

  /** Llama `GET /api/espacios` (público). Nunca lanza: ante cualquier error de red deja `espacios` en `[]` y marca `errorEspacios` en `true`. */
  async cargarEspacios(): Promise<void> {
    this.errorEspaciosSignal.set(false);
    try {
      const idToken = await this.authService.obtenerIdToken();
      const espacios = await firstValueFrom(this.http.get<Espacio[]>('/api/espacios', this.cabeceras(idToken)));
      this.espaciosSignal.set(espacios);
    } catch {
      this.espaciosSignal.set([]);
      this.errorEspaciosSignal.set(true);
    }
  }

  /** Llama `POST /api/espacios`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403` o error de red. Tras un `201` exitoso, recarga `espacios`. */
  async crearEspacio(datos: DatosEspacio): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear el espacio. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.post<Espacio>('/api/espacios', datos, this.cabeceras(idToken)));
      await this.cargarEspacios();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo crear el espacio. Intenta de nuevo.') };
    }
  }

  /** Llama `PUT /api/espacios/{espacioId}`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404` o error de red. Tras un `200` exitoso, recarga `espacios`. */
  async actualizarEspacio(espacioId: string, datos: DatosEspacio): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar el espacio. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.put<Espacio>(`/api/espacios/${espacioId}`, datos, this.cabeceras(idToken)));
      await this.cargarEspacios();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo actualizar el espacio. Intenta de nuevo.') };
    }
  }

  /** Llama `DELETE /api/espacios/{espacioId}`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404`, `400` (tiene muebles asociados) o error de red. Tras un `204` exitoso, recarga `espacios`. */
  async eliminarEspacio(espacioId: string): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el espacio. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.delete<void>(`/api/espacios/${espacioId}`, this.cabeceras(idToken)));
      await this.cargarEspacios();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo eliminar el espacio. Intenta de nuevo.') };
    }
  }

  // ---------------------------------------------------------------------
  // Muebles
  // ---------------------------------------------------------------------

  /** Llama `GET /api/muebles` (público). Nunca lanza: ante cualquier error de red deja `muebles` en `[]` y marca `errorMuebles` en `true`. */
  async cargarMuebles(): Promise<void> {
    this.errorMueblesSignal.set(false);
    try {
      const idToken = await this.authService.obtenerIdToken();
      const muebles = await firstValueFrom(this.http.get<Mueble[]>('/api/muebles', this.cabeceras(idToken)));
      this.mueblesSignal.set(muebles);
    } catch {
      this.mueblesSignal.set([]);
      this.errorMueblesSignal.set(true);
    }
  }

  /** Llama `POST /api/muebles`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `400` (espacioId inexistente) o error de red. Tras un `201` exitoso, recarga `muebles`. */
  async crearMueble(datos: DatosMueble): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear el mueble. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.post<Mueble>('/api/muebles', datos, this.cabeceras(idToken)));
      await this.cargarMuebles();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo crear el mueble. Intenta de nuevo.') };
    }
  }

  /** Llama `PUT /api/muebles/{muebleId}`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404`, `400` (espacioId inexistente) o error de red. Tras un `200` exitoso, recarga `muebles`. */
  async actualizarMueble(muebleId: string, datos: DatosMueble): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar el mueble. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.put<Mueble>(`/api/muebles/${muebleId}`, datos, this.cabeceras(idToken)));
      await this.cargarMuebles();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo actualizar el mueble. Intenta de nuevo.') };
    }
  }

  /** Llama `DELETE /api/muebles/{muebleId}`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404`, `400` (tiene ubicaciones asociadas) o error de red. Tras un `204` exitoso, recarga `muebles`. */
  async eliminarMueble(muebleId: string): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el mueble. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.delete<void>(`/api/muebles/${muebleId}`, this.cabeceras(idToken)));
      await this.cargarMuebles();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo eliminar el mueble. Intenta de nuevo.') };
    }
  }

  // ---------------------------------------------------------------------
  // Ubicaciones
  // ---------------------------------------------------------------------

  /** Llama `GET /api/ubicaciones` (público). Nunca lanza: ante cualquier error de red deja `ubicaciones` en `[]` y marca `errorUbicaciones` en `true`. */
  async cargarUbicaciones(): Promise<void> {
    this.errorUbicacionesSignal.set(false);
    try {
      const idToken = await this.authService.obtenerIdToken();
      const ubicaciones = await firstValueFrom(this.http.get<Ubicacion[]>('/api/ubicaciones', this.cabeceras(idToken)));
      this.ubicacionesSignal.set(ubicaciones);
    } catch {
      this.ubicacionesSignal.set([]);
      this.errorUbicacionesSignal.set(true);
    }
  }

  /** Llama `POST /api/ubicaciones`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `400` (muebleId inexistente) o error de red. Tras un `201` exitoso, recarga `ubicaciones`. */
  async crearUbicacion(datos: DatosUbicacion): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear la ubicación. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.post<Ubicacion>('/api/ubicaciones', datos, this.cabeceras(idToken)));
      await this.cargarUbicaciones();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo crear la ubicación. Intenta de nuevo.') };
    }
  }

  /** Llama `PUT /api/ubicaciones/{ubicacionId}`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404`, `400` (muebleId inexistente) o error de red. Tras un `200` exitoso, recarga `ubicaciones`. */
  async actualizarUbicacion(ubicacionId: string, datos: DatosUbicacion): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar la ubicación. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.put<Ubicacion>(`/api/ubicaciones/${ubicacionId}`, datos, this.cabeceras(idToken)));
      await this.cargarUbicaciones();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo actualizar la ubicación. Intenta de nuevo.') };
    }
  }

  /** Llama `DELETE /api/ubicaciones/{ubicacionId}`. Nunca lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404` o error de red. Tras un `204` exitoso, recarga `ubicaciones`. */
  async eliminarUbicacion(ubicacionId: string): Promise<ResultadoOperacionUbicacionFisica> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar la ubicación. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(this.http.delete<void>(`/api/ubicaciones/${ubicacionId}`, this.cabeceras(idToken)));
      await this.cargarUbicaciones();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo eliminar la ubicación. Intenta de nuevo.') };
    }
  }
}
