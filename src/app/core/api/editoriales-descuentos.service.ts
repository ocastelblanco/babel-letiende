import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DescuentoEditorial } from '../models/descuento-editorial.model';

/** Datos editables de un descuento editorial — sin `editorial`, que va en la URL al editar y no se puede cambiar tras crearlo (mismo contrato que `PUT /api/editoriales-descuentos/{editorial}`). */
export interface DatosDescuentoEditorial {
  porcentajePorDefecto: number;
  porcentajesDisponibles: number[];
}

/** Datos para crear un descuento editorial nuevo — incluye `editorial`, la clave primaria, que solo se suministra al crear (mismo contrato que `POST /api/editoriales-descuentos`). */
export interface DatosNuevoDescuentoEditorial extends DatosDescuentoEditorial {
  editorial: string;
}

/**
 * Resultado de una operación de escritura (`crearDescuento`/`actualizarDescuento`/`eliminarDescuento`):
 * a diferencia de `cargarDescuentos()`, estas operaciones nunca lanzan pero sí
 * necesitan devolver un mensaje de error específico para mostrarlo en la UI
 * (`GestionDescuentosEditorialesComponent`) — incluido el `409` de editorial
 * duplicada y el `404` de editorial inexistente.
 */
export type ResultadoOperacionDescuentoEditorial = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `/api/editoriales-descuentos` (tech-specs.md §4.3, PRD.md §5.6).
 * Expone el CRUD completo — mismo patrón que `UsuariosService`: peticiones
 * autenticadas con el ID Token actual. `crearDescuento` recibe `editorial`
 * (la clave primaria, suministrada por el administrador, no la genera el
 * backend) — a diferencia de `actualizarDescuento`, que recibe la
 * `editorial` por separado porque va en la URL. Todas las operaciones son
 * exclusivas de `administrador` en el backend (`CLAUDE.md` A01); este
 * servicio nunca decide por sí mismo si el usuario puede escribir, solo
 * reenvía el `403`/`404`/`409` del backend.
 */
@Injectable({ providedIn: 'root' })
export class EditorialesDescuentosService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly descuentosSignal = signal<DescuentoEditorial[]>([]);
  /** Último listado resuelto por `cargarDescuentos()`. */
  readonly descuentos = this.descuentosSignal.asReadonly();

  private readonly errorSignal = signal(false);
  /** `true` si la última llamada a `cargarDescuentos()` falló. */
  readonly error = this.errorSignal.asReadonly();

  /**
   * Llama `GET /api/editoriales-descuentos` con el ID Token actual. Nunca
   * lanza: ante cualquier caso sin autorización (sin sesión, `401`, `403`,
   * error de red) deja `descuentos` en `[]` y marca `error` en `true`.
   */
  async cargarDescuentos(): Promise<void> {
    this.errorSignal.set(false);

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      this.descuentosSignal.set([]);
      this.errorSignal.set(true);
      return;
    }

    try {
      const descuentos = await firstValueFrom(
        this.http.get<DescuentoEditorial[]>('/api/editoriales-descuentos', {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      this.descuentosSignal.set(descuentos);
    } catch {
      this.descuentosSignal.set([]);
      this.errorSignal.set(true);
    }
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `UsuariosService`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }

  /**
   * Llama `POST /api/editoriales-descuentos` con el ID Token actual. Nunca
   * lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`
   * (rol insuficiente, `CLAUDE.md` A01), `409` (editorial ya existe) o error
   * de red. Tras un `201` exitoso, recarga `descuentos` con `cargarDescuentos()`.
   */
  async crearDescuento(datos: DatosNuevoDescuentoEditorial): Promise<ResultadoOperacionDescuentoEditorial> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear el descuento editorial. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.post<DescuentoEditorial>('/api/editoriales-descuentos', datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarDescuentos();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo crear el descuento editorial. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `PUT /api/editoriales-descuentos/{editorial}` con el ID Token
   * actual. Nunca lanza: devuelve `{ exito: false, error }` ante sesión
   * ausente, `403`, `404` (editorial inexistente) o error de red. Tras un
   * `200` exitoso, recarga `descuentos` con `cargarDescuentos()`.
   */
  async actualizarDescuento(
    editorial: string,
    datos: DatosDescuentoEditorial,
  ): Promise<ResultadoOperacionDescuentoEditorial> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar el descuento editorial. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.put<DescuentoEditorial>(`/api/editoriales-descuentos/${editorial}`, datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarDescuentos();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo actualizar el descuento editorial. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `DELETE /api/editoriales-descuentos/{editorial}` con el ID Token
   * actual. Nunca lanza: devuelve `{ exito: false, error }` ante sesión
   * ausente, `403`, `404` o error de red. Tras un `204` exitoso, recarga
   * `descuentos` con `cargarDescuentos()`.
   */
  async eliminarDescuento(editorial: string): Promise<ResultadoOperacionDescuentoEditorial> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el descuento editorial. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.delete<void>(`/api/editoriales-descuentos/${editorial}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarDescuentos();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo eliminar el descuento editorial. Intenta de nuevo.'),
      };
    }
  }
}
