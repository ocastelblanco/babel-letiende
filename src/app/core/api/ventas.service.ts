import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { FormaDePago } from '../models/venta.model';

/** Filtros opcionales de `GET /api/ventas/exportar` — mismo contrato que `FiltrosVentas` del backend (`server/api/handlers/ventas.ts`). */
export interface FiltrosExportarVentas {
  desde?: string;
  hasta?: string;
  editorial?: string;
  formaDePago?: FormaDePago;
}

/** Resultado de `exportarVentas` — nunca lanza, para que el componente muestre un mensaje de error en vez de una excepción sin manejar. */
export type ResultadoExportarVentas = { exito: true } | { exito: false; error: string };

/**
 * Cliente de `GET /api/ventas/exportar` (tech-specs.md §5.5, TODO.md
 * Tarea 1) — mismo patrón de autenticación que `EditorialesDescuentosService`,
 * pero la petición pide un blob binario (`.xlsx`) en vez de JSON y dispara la
 * descarga en el navegador en lugar de exponer un Signal de estado.
 * Exclusivo de `administrador` en el backend (`CLAUDE.md` A01); este
 * servicio nunca decide por sí mismo si el usuario puede exportar, solo
 * reenvía el `403` del backend como mensaje de error.
 */
@Injectable({ providedIn: 'root' })
export class VentasService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  /**
   * Llama `GET /api/ventas/exportar` con el ID Token actual y los filtros
   * dados, y dispara la descarga del `.xlsx` recibido. Nunca lanza: ante
   * sesión ausente, `403`, `400` (filtro inválido) o error de red, devuelve
   * `{ exito: false, error }` para que el componente muestre el mensaje.
   */
  async exportarVentas(filtros: FiltrosExportarVentas = {}): Promise<ResultadoExportarVentas> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo exportar el reporte de ventas. Intenta de nuevo.' };
    }

    let params = new HttpParams();
    if (filtros.desde) {
      params = params.set('desde', filtros.desde);
    }
    if (filtros.hasta) {
      params = params.set('hasta', filtros.hasta);
    }
    if (filtros.editorial) {
      params = params.set('editorial', filtros.editorial);
    }
    if (filtros.formaDePago) {
      params = params.set('formaDePago', filtros.formaDePago);
    }

    try {
      const archivo = await firstValueFrom(
        this.http.get('/api/ventas/exportar', {
          headers: { Authorization: `Bearer ${idToken}` },
          params,
          responseType: 'blob',
        }),
      );
      this.descargarArchivo(archivo);
      return { exito: true };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo exportar el reporte de ventas. Intenta de nuevo.'),
      };
    }
  }

  /** Dispara la descarga de un blob en el navegador con un `<a>` temporal — mismo patrón recomendado por MDN para `Blob`/`URL.createObjectURL`. */
  private descargarArchivo(archivo: Blob): void {
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = 'reporte-ventas.xlsx';
    enlace.click();
    URL.revokeObjectURL(url);
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `EditorialesDescuentosService`. Con `responseType: 'blob'`, el cuerpo de un error JSON llega como Blob, no como objeto, así que normalmente cae al mensaje por defecto. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }
}
