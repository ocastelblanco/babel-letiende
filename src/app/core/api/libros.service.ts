import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Libro } from '../models/libro.model';

/**
 * Cliente de `GET /api/libros` (tech-specs.md §5) — endpoint público, sin
 * autenticación. Expone el catálogo disponible como Signal de solo lectura.
 */
@Injectable({ providedIn: 'root' })
export class LibrosService {
  private readonly http = inject(HttpClient);

  private readonly librosSignal = signal<Libro[]>([]);
  /** Último catálogo resuelto por `cargarCatalogo()`. */
  readonly libros = this.librosSignal.asReadonly();

  private readonly cargandoSignal = signal(false);
  readonly cargando = this.cargandoSignal.asReadonly();

  private readonly errorSignal = signal(false);
  /** `true` si la última llamada a `cargarCatalogo()` falló. */
  readonly error = this.errorSignal.asReadonly();

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
}
