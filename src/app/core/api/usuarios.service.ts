import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Usuario } from '../models/usuario.model';

/**
 * Cliente de `GET /api/usuarios/me` (tech-specs.md §5, §8). Resuelve el
 * `Usuario`/rol del usuario autenticado — nunca asume autorización a partir
 * de estar autenticado en el proyecto Firebase compartido (CLAUDE.md A01).
 */
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private readonly usuarioActualSignal = signal<Usuario | null>(null);
  /** Último `Usuario` resuelto por `obtenerUsuarioActual()` (o `null`). */
  readonly usuarioActual = this.usuarioActualSignal.asReadonly();

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
}
