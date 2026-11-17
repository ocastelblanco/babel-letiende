import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ResumenCargaConocimiento } from '../models/carga-conocimiento.model';

/** Como `ResultadoIniciarValidacion`: el `409` (ya hay una carga) no es un error de UI, es "retomar". */
export type ResultadoIniciarCarga =
  | { iniciada: true; cargaId: string }
  | { iniciada: false; cargaIdEnCurso: string; error: string }
  | { iniciada: false; cargaIdEnCurso: null; error: string };

/**
 * Cliente de `/api/carga-conocimiento` (T-0013, ADR-012): dispara la carga
 * retroactiva de sinopsis y datos del asistente y consulta su progreso. Exclusivo de
 * `administrador` en el backend (CLAUDE.md A01); este servicio nunca decide permisos.
 * Nunca lanza.
 */
@Injectable({ providedIn: 'root' })
export class CargaConocimientoService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  private mensajeError(error: unknown, porDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string' ? error.error.error : porDefecto;
  }

  async iniciar(): Promise<ResultadoIniciarCarga> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { iniciada: false, cargaIdEnCurso: null, error: 'No se pudo iniciar la carga. Intenta de nuevo.' };
    }
    try {
      const respuesta = await firstValueFrom(
        this.http.post<{ cargaId: string }>('/api/carga-conocimiento', {}, { headers: { Authorization: `Bearer ${idToken}` } }),
      );
      return { iniciada: true, cargaId: respuesta.cargaId };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && typeof error.error?.cargaId === 'string') {
        return { iniciada: false, cargaIdEnCurso: error.error.cargaId, error: this.mensajeError(error, 'Ya hay una carga en curso.') };
      }
      return { iniciada: false, cargaIdEnCurso: null, error: this.mensajeError(error, 'No se pudo iniciar la carga. Intenta de nuevo.') };
    }
  }

  /** `null` ante sesión ausente, `403`, `404` o error de red. */
  async consultar(cargaId: string): Promise<ResumenCargaConocimiento | null> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return null;
    }
    try {
      return await firstValueFrom(
        this.http.get<ResumenCargaConocimiento>(`/api/carga-conocimiento/${cargaId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
    } catch {
      return null;
    }
  }
}
