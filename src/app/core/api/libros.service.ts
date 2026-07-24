import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Libro, LibroConUbicacion } from '../models/libro.model';

/** Datos editables de un libro ya catalogado — mismo contrato que `PUT /api/libros/{bookId}` (`TODO.md`, área "Gestionar", pestaña "Editar"). */
export interface DatosEditarLibro {
  ubicacionId: string;
  cantidadTotal: number;
  pvp: number;
  porcentajeDescuentoEditorial: number;
}

/**
 * Resultado de una operación de escritura (`editarLibro`/`eliminarLibro`): a
 * diferencia de `cargarCatalogo()`/`cargarInventario()`, estas operaciones
 * nunca lanzan pero sí necesitan devolver un mensaje de error específico
 * para mostrarlo en la UI — mismo patrón que `UbicacionFisicaService`.
 */
export type ResultadoOperacionLibro = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `/api/libros` (tech-specs.md §5). `GET /api/libros` y
 * `GET /api/libros/:bookId` son públicos, sin autenticación. `cargarInventario`
 * (`GET /api/libros/inventario`), `editarLibro` (`PUT /api/libros/:bookId`) y
 * `eliminarLibro` (`DELETE /api/libros/:bookId`) exigen sesión — el backend
 * valida siempre el rol real contra `babel-usuarios` (CLAUDE.md A01); este
 * servicio nunca decide por sí mismo si el usuario puede escribir.
 */
@Injectable({ providedIn: 'root' })
export class LibrosService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private readonly librosSignal = signal<Libro[]>([]);
  /** Último catálogo resuelto por `cargarCatalogo()`. */
  readonly libros = this.librosSignal.asReadonly();

  private readonly cargandoSignal = signal(false);
  readonly cargando = this.cargandoSignal.asReadonly();

  private readonly errorSignal = signal(false);
  /** `true` si la última llamada a `cargarCatalogo()` falló. */
  readonly error = this.errorSignal.asReadonly();

  private readonly inventarioSignal = signal<Libro[]>([]);
  /** Último listado completo (incluidos agotados) resuelto por `cargarInventario()` — pestaña "Editar" del área "Gestionar". */
  readonly inventario = this.inventarioSignal.asReadonly();

  private readonly cargandoInventarioSignal = signal(false);
  readonly cargandoInventario = this.cargandoInventarioSignal.asReadonly();

  private readonly errorInventarioSignal = signal(false);
  /** `true` si la última llamada a `cargarInventario()` falló (sin sesión, `403`, error de red). */
  readonly errorInventario = this.errorInventarioSignal.asReadonly();

  /**
   * Llama `GET /api/libros`. Nunca lanza: ante un error de red o del
   * servidor deja `libros` en `[]` y marca `error` en `true`, para que el
   * componente pueda mostrar un mensaje sin romper el renderizado SSR.
   */
  async cargarCatalogo(): Promise<void> {
    this.cargandoSignal.set(true);
    this.errorSignal.set(false);

    try {
      const libros = await firstValueFrom(this.http.get<Libro[]>('/api/libros'));
      this.librosSignal.set(libros);
    } catch {
      this.librosSignal.set([]);
      this.errorSignal.set(true);
    } finally {
      this.cargandoSignal.set(false);
    }
  }

  /**
   * Llama `GET /api/libros/:bookId` (ficha pública, `TODO.md`) — endpoint
   * público, sin autenticación. Nunca lanza: ante `404`, cualquier otro
   * error HTTP o de red, devuelve `null` — el componente lo trata como
   * "libro no encontrado" (mismo criterio "nunca lanza" que
   * `cargarCatalogo`), sin distinguir la causa exacta ante el visitante.
   */
  async obtenerDetalle(bookId: string): Promise<LibroConUbicacion | null> {
    try {
      return await firstValueFrom(this.http.get<LibroConUbicacion>(`/api/libros/${bookId}`));
    } catch {
      return null;
    }
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `UbicacionFisicaService`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }

  /**
   * Llama `GET /api/libros/inventario` con el ID Token actual — listado
   * completo de libros, incluidos los agotados (`cantidadDisponible: 0`),
   * para la pestaña "Editar" del área "Gestionar" (`TODO.md`). Nunca lanza:
   * ante cualquier caso sin autorización (sin sesión, `403`, error de red)
   * deja `inventario` en `[]` y marca `errorInventario` en `true`.
   */
  async cargarInventario(): Promise<void> {
    this.cargandoInventarioSignal.set(true);
    this.errorInventarioSignal.set(false);

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      this.inventarioSignal.set([]);
      this.errorInventarioSignal.set(true);
      this.cargandoInventarioSignal.set(false);
      return;
    }

    try {
      const inventario = await firstValueFrom(
        this.http.get<Libro[]>('/api/libros/inventario', {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      this.inventarioSignal.set(inventario);
    } catch {
      this.inventarioSignal.set([]);
      this.errorInventarioSignal.set(true);
    } finally {
      this.cargandoInventarioSignal.set(false);
    }
  }

  /**
   * Llama `PUT /api/libros/{bookId}` con el ID Token actual. Nunca lanza:
   * devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404`,
   * `400` (ubicacionId inexistente o datos inválidos) o error de red. Tras
   * un `200` exitoso, recarga `inventario` con `cargarInventario()`.
   */
  async editarLibro(bookId: string, datos: DatosEditarLibro): Promise<ResultadoOperacionLibro> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo editar el libro. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(
        this.http.put<Libro>(`/api/libros/${bookId}`, datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarInventario();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo editar el libro. Intenta de nuevo.') };
    }
  }

  /**
   * Llama `DELETE /api/libros/{bookId}` con el ID Token actual. Nunca lanza:
   * devuelve `{ exito: false, error }` ante sesión ausente, `403` (exclusivo
   * de `administrador`, CLAUDE.md A01), `404` o error de red. Tras un `204`
   * exitoso, recarga `inventario` con `cargarInventario()`.
   */
  async eliminarLibro(bookId: string): Promise<ResultadoOperacionLibro> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el libro. Intenta de nuevo.' };
    }
    try {
      await firstValueFrom(
        this.http.delete<void>(`/api/libros/${bookId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarInventario();
      return { exito: true };
    } catch (error) {
      return { exito: false, error: this.mensajeError(error, 'No se pudo eliminar el libro. Intenta de nuevo.') };
    }
  }
}
