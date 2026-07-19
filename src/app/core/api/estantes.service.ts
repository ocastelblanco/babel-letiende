import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Estante } from '../models/estante.model';

/**
 * Cliente de `GET /api/estantes` (tech-specs.md §5, "Admin") — mismo patrón
 * que `UsuariosService`: petición autenticada con el ID Token actual, nunca
 * lanza. Se usa para poblar el `<select>` de estante al catalogar un libro
 * (`CatalogarLibroComponent`).
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
}
