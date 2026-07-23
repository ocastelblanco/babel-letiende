import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/**
 * Metadatos bibliográficos de un libro resueltos por ISBN — mismo contrato
 * que `GET /api/metadatos/:isbn`. `pvp` proviene siempre del fallback de
 * scraping (`TODO.md`, Tarea 1 — Task C): la API externa nunca lo resuelve.
 */
export interface MetadatosLibro {
  titulo: string | null;
  autor: string | null;
  editorial: string | null;
  portadaUrl: string | null;
  pvp: number | null;
}

const METADATOS_VACIOS: MetadatosLibro = {
  titulo: null,
  autor: null,
  editorial: null,
  portadaUrl: null,
  pvp: null,
};

/**
 * Un candidato de la búsqueda por título/autor (`GET /api/metadatos/buscar`,
 * TODO.md — para cuando el vendedor no tiene el ISBN a mano) — mismo
 * contrato que `CandidatoLibro` en `server/api/services/api-letiende.ts`.
 * `isbn` es `null` cuando la fuente no lo expuso; en ese caso el PVP queda
 * manual tras seleccionar el candidato.
 */
export interface CandidatoLibro {
  titulo: string;
  autor: string | null;
  editorial: string | null;
  portadaUrl: string | null;
  isbn: string | null;
}

/**
 * Cliente de `GET /api/metadatos/:isbn` (TODO.md, autocompletado de
 * metadatos al catalogar) — mismo patrón que `EstantesService`: peticiones
 * autenticadas con el ID Token actual. Lo consume `CatalogarLibroComponent`
 * para pre-cargar título/autor/editorial/portada cuando hay un ISBN
 * disponible.
 */
@Injectable({ providedIn: 'root' })
export class MetadatosService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  /**
   * Nunca lanza: ante sesión ausente, cualquier error HTTP (401/403/5xx) o
   * de red, devuelve todos los campos en `null` — el llamador lo trata
   * exactamente igual que "no encontrado" (CLAUDE.md A08, PRD.md §5.2), sin
   * bloquear la edición manual del formulario.
   */
  async obtenerMetadatos(isbn: string): Promise<MetadatosLibro> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return METADATOS_VACIOS;
    }

    try {
      return await firstValueFrom(
        this.http.get<MetadatosLibro>(`/api/metadatos/${isbn}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
    } catch {
      return METADATOS_VACIOS;
    }
  }

  /**
   * Cliente de `GET /api/metadatos/buscar?titulo=&autor=` — para cuando el
   * vendedor no tiene el ISBN a mano (TODO.md, Tarea de búsqueda por
   * título/autor). Mismo criterio "nunca lanza" que `obtenerMetadatos`: ante
   * sesión ausente, cualquier error HTTP o de red, devuelve `[]` — el
   * llamador lo trata como "sin candidatos", sin bloquear el formulario.
   */
  async buscarCandidatos(titulo: string, autor: string): Promise<CandidatoLibro[]> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return [];
    }

    const parametros = new URLSearchParams();
    if (titulo.trim() !== '') {
      parametros.set('titulo', titulo.trim());
    }
    if (autor.trim() !== '') {
      parametros.set('autor', autor.trim());
    }

    try {
      const respuesta = await firstValueFrom(
        this.http.get<{ candidatos: CandidatoLibro[] }>(`/api/metadatos/buscar?${parametros.toString()}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      return respuesta.candidatos;
    } catch {
      return [];
    }
  }
}
