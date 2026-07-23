import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { FiltrosExportarVentas, VentasService } from '../../core/api/ventas.service';
import { FormaDePago } from '../../core/models/venta.model';

/** Mismas 5 formas de pago aceptadas por el backend (`server/api/handlers/ventas.ts`, `FORMAS_DE_PAGO`) — el `<select>` agrega una opción "Todas" (valor vacío) que no se envía como filtro. */
const FORMAS_DE_PAGO: readonly FormaDePago[] = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata'];

/**
 * Ruta protegida `/admin/reportes` (`RoleGuard('administrador')`,
 * PRD.md §5.5, TODO.md Tarea 1) — formulario de filtros opcionales para
 * exportar el reporte de ventas a Excel. No lista las ventas en pantalla
 * (fuera de alcance de esta tarea, ver TODO.md); solo dispara la descarga
 * del `.xlsx` que genera `GET /api/ventas/exportar`. La autorización real la
 * vuelve a verificar siempre `VentasService`/el backend (`CLAUDE.md` A01) —
 * este componente nunca decide por sí mismo si el usuario puede exportar.
 *
 * `desde`/`hasta` son inputs `type="date"` (`YYYY-MM-DD`): se normalizan al
 * inicio/fin del día en UTC antes de enviarlos, para que un `hasta` elegido
 * por el usuario incluya todas las ventas de ese día (el backend compara
 * `Venta.vendidoEn` — un ISO completo con hora — como string; sin esta
 * normalización, un `hasta` de solo fecha excluiría casi todas las ventas
 * de ese mismo día, ver `handlerListar`/`consultarVentasFiltradas`).
 */
@Component({
  selector: 'app-reportes-ventas',
  imports: [ReactiveFormsModule],
  templateUrl: './reportes-ventas.component.html',
})
export class ReportesVentasComponent {
  private readonly fb = inject(FormBuilder);
  private readonly ventasService = inject(VentasService);

  protected readonly formasDePago = FORMAS_DE_PAGO;

  protected readonly exportando = signal(false);
  protected readonly mensajeError = signal<string | null>(null);
  protected readonly mensajeExito = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    desde: [''],
    hasta: [''],
    editorial: [''],
    formaDePago: [''],
  });

  protected async exportar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    const valores = this.formulario.getRawValue();
    const filtros: FiltrosExportarVentas = {};
    if (valores.desde) {
      filtros.desde = `${valores.desde}T00:00:00.000Z`;
    }
    if (valores.hasta) {
      filtros.hasta = `${valores.hasta}T23:59:59.999Z`;
    }
    if (valores.editorial.trim()) {
      filtros.editorial = valores.editorial.trim();
    }
    if (valores.formaDePago) {
      filtros.formaDePago = valores.formaDePago as FormaDePago;
    }

    this.exportando.set(true);
    try {
      const resultado = await this.ventasService.exportarVentas(filtros);
      if (resultado.exito) {
        this.mensajeExito.set('Reporte exportado correctamente.');
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.exportando.set(false);
    }
  }
}
