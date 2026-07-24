import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { FormaDePago, Venta } from '../models/venta.model';

/** Datos que envía el diálogo "Vender" — el resto (`pvp`/`costoLibro`/`precioFinal`/`utilidad`) lo calcula el backend (`CLAUDE.md` A08). */
export interface DatosNuevaVenta {
  bookId: string;
  cantidad: number;
  porcentajeDescuentoVenta: number;
  formaDePago: FormaDePago;
}

/** Resultado de `registrarVenta` — nunca lanza, para que el componente muestre un mensaje en vez de una excepción sin manejar (mismo patrón que `UsuariosService`/`VentasService`). */
export type ResultadoRegistrarVenta = { exito: true; venta: Venta } | { exito: false; error: string };

/**
 * Cliente de `POST /api/ventas` (tech-specs.md §5, TODO.md Tarea 2) —
 * registra la venta de un libro desde su ficha. Nombrado en singular
 * (`VentaService`, a diferencia de `VentasService`) porque su responsabilidad
 * es distinta: `VentasService` expone el reporte/exportación de muchas
 * ventas (exclusivo de administrador), mientras este servicio registra una
 * venta puntual (vendedor o administrador) — mismo criterio de un servicio
 * por endpoint ya usado en el resto de `core/api/`. Exige rol `vendedor` o
 * `administrador` en el backend (`CLAUDE.md` A01); este servicio nunca
 * decide por sí mismo si el usuario puede vender, solo reenvía el `403` del
 * backend como mensaje de error.
 */
@Injectable({ providedIn: 'root' })
export class VentaService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  /**
   * Llama `POST /api/ventas` con el ID Token actual. Nunca lanza: ante
   * sesión ausente, `403` (rol insuficiente), `400` (validación o sin
   * ejemplares suficientes) o error de red, devuelve `{ exito: false, error }`
   * para que el componente muestre el mensaje.
   */
  async registrarVenta(datos: DatosNuevaVenta): Promise<ResultadoRegistrarVenta> {
    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return { exito: false, error: 'No se pudo registrar la venta. Intenta de nuevo.' };
    }

    try {
      const venta = await firstValueFrom(
        this.http.post<Venta>('/api/ventas', datos, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      return { exito: true, venta };
    } catch (error) {
      return {
        exito: false,
        error: this.mensajeError(error, 'No se pudo registrar la venta. Intenta de nuevo.'),
      };
    }
  }

  /** Extrae el mensaje de error del backend (`{ error: string }`) o cae a un mensaje genérico — mismo patrón que `UsuariosService`. */
  private mensajeError(error: unknown, mensajePorDefecto: string): string {
    return error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
      ? error.error.error
      : mensajePorDefecto;
  }
}
