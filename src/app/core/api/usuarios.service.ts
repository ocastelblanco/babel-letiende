import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { RolUsuario, Usuario } from '../models/usuario.model';

/** Datos editables de un usuario — sin `email`, que va en la URL al editar y no se puede cambiar tras crearlo (mismo contrato que `PUT /api/usuarios/{email}`). */
export interface DatosUsuario {
  nombre: string;
  rol: RolUsuario;
}

/** Datos para crear un usuario nuevo — incluye `email`, la clave primaria, que solo se suministra al crear (mismo contrato que `POST /api/usuarios`). */
export interface DatosNuevoUsuario extends DatosUsuario {
  email: string;
}

/**
 * Resultado de una operación de escritura (`crearUsuario`/`actualizarUsuario`/`eliminarUsuario`):
 * a diferencia de `cargarUsuarios()`, estas operaciones nunca lanzan pero sí
 * necesitan devolver un mensaje de error específico para mostrarlo en la UI
 * (`GestionUsuariosComponent`) — incluido el `400` de la salvaguarda ADR-009
 * cuando un administrador intenta degradar su propio rol o eliminarse a sí mismo.
 */
export type ResultadoOperacionUsuario = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `/api/usuarios` (tech-specs.md §5, §8, PRD.md §5.6). Resuelve el
 * `Usuario`/rol del usuario autenticado (`GET /api/usuarios/me`) y expone el
 * CRUD completo — mismo patrón que `EstantesService`/`SitiosScrapingService`:
 * peticiones autenticadas con el ID Token actual. `crearUsuario` recibe
 * `email` (la clave primaria, suministrada por el administrador, no la
 * genera el backend) — a diferencia de `actualizarUsuario`, que recibe el
 * `email` por separado porque va en la URL. Todas las operaciones de escritura
 * son exclusivas de `administrador` en el backend (`CLAUDE.md` A01), incluida
 * la salvaguarda ADR-009 (un administrador no puede cambiar su propio rol ni
 * eliminarse a sí mismo vía este endpoint); este servicio nunca decide por sí
 * mismo si el usuario puede escribir, solo reenvía el `400` del backend.
 */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly usuarioActualSignal = signal<Usuario | null>(null);
  /** Último `Usuario` resuelto por `obtenerUsuarioActual()` (o `null`). */
  readonly usuarioActual = this.usuarioActualSignal.asReadonly();

  private readonly usuariosSignal = signal<Usuario[]>([]);
  /** Último listado resuelto por `cargarUsuarios()`. */
  readonly usuarios = this.usuariosSignal.asReadonly();

  private readonly errorSignal = signal(false);
  /** `true` si la última llamada a `cargarUsuarios()` falló. */
  readonly error = this.errorSignal.asReadonly();

  /**
   * Llama `GET /api/usuarios/me` con el ID Token actual. Nunca lanza: ante
   * cualquier caso sin autorización (sin sesión, `401`, `403`, error de red)
   * resuelve `null` — quien llame (ej. `RoleGuard`) debe tratar `null` como
   * "sin autorización", nunca como "todavía no se sabe".
   */
  async obtenerUsuarioActual(): Promise<Usuario | null> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      this.usuarioActualSignal.set(null);
      return null;
    }

    try {
      const usuario = await firstValueFrom(
        this.http.get<Usuario>('/api/usuarios/me', {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      this.usuarioActualSignal.set(usuario);
      return usuario;
    } catch {
      this.usuarioActualSignal.set(null);
      return null;
    }
  }

  /**
   * Llama `GET /api/usuarios` con el ID Token actual. Nunca lanza: ante
   * cualquier caso sin autorización (sin sesión, `401`, `403`, error de red)
   * deja `usuarios` en `[]` y marca `error` en `true`.
   */
  async cargarUsuarios(): Promise<void> {
    this.errorSignal.set(false);

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      this.usuariosSignal.set([]);
      this.errorSignal.set(true);
      return;
    }

    try {
      const usuarios = await firstValueFrom(
        this.http.get<Usuario[]>('/api/usuarios', {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      this.usuariosSignal.set(usuarios);
    } catch {
      this.usuariosSignal.set([]);
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
   * Llama `POST /api/usuarios` con el ID Token actual. Nunca lanza: devuelve
   * `{ exito: false, error }` ante sesión ausente, `403` (rol insuficiente,
   * `CLAUDE.md` A01), `409` (email ya registrado) o error de red. Tras un
   * `201` exitoso, recarga `usuarios` con `cargarUsuarios()`.
   */
  async crearUsuario(datos: DatosNuevoUsuario): Promise<ResultadoOperacionUsuario> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo crear el usuario. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.post<Usuario>('/api/usuarios', datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarUsuarios();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo crear el usuario. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `PUT /api/usuarios/{email}` con el ID Token actual. Nunca lanza:
   * devuelve `{ exito: false, error }` ante sesión ausente, `403`, `404`
   * (email inexistente) o el `400` de la salvaguarda ADR-009 (un
   * administrador no puede degradar su propio rol vía este endpoint). Tras
   * un `200` exitoso, recarga `usuarios` con `cargarUsuarios()`.
   */
  async actualizarUsuario(email: string, datos: DatosUsuario): Promise<ResultadoOperacionUsuario> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo actualizar el usuario. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.put<Usuario>(`/api/usuarios/${email}`, datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarUsuarios();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo actualizar el usuario. Intenta de nuevo.'),
      };
    }
  }

  /**
   * Llama `DELETE /api/usuarios/{email}` con el ID Token actual. Nunca
   * lanza: devuelve `{ exito: false, error }` ante sesión ausente, `403`,
   * `404` o el `400` de la salvaguarda ADR-009 (un administrador no puede
   * eliminarse a sí mismo vía este endpoint). Tras un `204` exitoso, recarga
   * `usuarios` con `cargarUsuarios()`.
   */
  async eliminarUsuario(email: string): Promise<ResultadoOperacionUsuario> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo eliminar el usuario. Intenta de nuevo.' };
    }

    try {
      await firstValueFrom(
        this.http.delete<void>(`/api/usuarios/${email}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      await this.cargarUsuarios();
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo eliminar el usuario. Intenta de nuevo.'),
      };
    }
  }
}
