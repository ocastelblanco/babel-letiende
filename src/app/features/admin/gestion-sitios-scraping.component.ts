import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatosSitioScraping, SitiosScrapingService } from '../../core/api/sitios-scraping.service';
import { SitioScraping } from '../../core/models/sitio-scraping.model';

/**
 * Ruta protegida `/admin/sitios` (`RoleGuard('administrador')`,
 * `plan-obtencion-info-libros.md` §6 Task A, ADR-010) — CRUD de la lista
 * única de sitios de scraping (banderas `info`/`pvp` independientes). Un
 * único formulario reactivo se reutiliza para crear y editar:
 * `sitioEditandoDominio` distingue el modo (`null` = crear, un `dominio` =
 * editando esa fila) — mismo patrón que `GestionEstantesComponent`. El
 * `dominio` es la clave primaria suministrada por el administrador al
 * crear, así que su control se deshabilita al editar (no se puede cambiar
 * la clave de una fila existente). La autorización real la vuelve a
 * verificar siempre `SitiosScrapingService`/el backend (`CLAUDE.md` A01) —
 * este componente nunca decide por sí mismo si el usuario puede escribir.
 * Este componente NUNCA hace scraping ni ninguna petición saliente a los
 * sitios — eso es la Tarea 2, completamente separada.
 *
 * `prioridad` ya no se edita a mano: el orden visual de "Sitios
 * registrados" (arrastrable con `@angular/cdk` `DragDropModule`) es la
 * fuente de verdad. Al crear un sitio se calcula automáticamente
 * `max(prioridades existentes) + 1`; al editar se reenvía la `prioridad`
 * actual sin cambiarla; al arrastrar se renumera 1..N según la posición
 * final y se persiste con `actualizarSitio` (una llamada por sitio cuyo
 * orden cambió). El backend sigue exigiendo `prioridad` en el contrato
 * (`server/api/handlers/sitios-scraping.ts`), así que nunca se quita del
 * modelo/`DatosSitioScraping` — solo deja de tener un control visible.
 */
@Component({
  selector: 'app-gestion-sitios-scraping',
  imports: [ReactiveFormsModule, DragDropModule],
  templateUrl: './gestion-sitios-scraping.component.html',
})
export class GestionSitiosScrapingComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly sitiosScrapingService = inject(SitiosScrapingService);

  protected readonly errorCarga = this.sitiosScrapingService.error;

  /** Sitios registrados ordenados por `prioridad` ascendente — el backend no garantiza orden (`Scan` de DynamoDB). */
  protected readonly sitios = computed(() =>
    [...this.sitiosScrapingService.sitios()].sort((a, b) => a.prioridad - b.prioridad),
  );

  protected readonly guardando = signal(false);
  protected readonly eliminandoDominio = signal<string | null>(null);
  protected readonly reordenando = signal(false);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** Controla si el formulario de creación/edición está desplegado — oculto por defecto. */
  protected readonly formularioVisible = signal(false);

  /** `null` mientras se crea un sitio nuevo; el `dominio` de la fila mientras se edita. */
  protected readonly sitioEditandoDominio = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    dominio: ['', Validators.required],
    nombre: ['', Validators.required],
    url: ['', Validators.required],
    info: [false],
    pvp: [false],
  });

  ngOnInit(): void {
    void this.sitiosScrapingService.cargarSitios();
  }

  /** Limpia cualquier estado de edición previo y abre el formulario vacío en modo "crear". */
  protected agregar(): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.sitioEditandoDominio.set(null);
    this.formulario.reset({ dominio: '', nombre: '', url: '', info: false, pvp: false });
    this.formulario.controls.dominio.enable();
    this.formularioVisible.set(true);
  }

  /** Precarga el formulario con los datos de la fila, deshabilita `dominio` (clave primaria, no editable) y entra en modo edición. */
  protected editar(sitio: SitioScraping): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.sitioEditandoDominio.set(sitio.dominio);
    this.formulario.setValue({
      dominio: sitio.dominio,
      nombre: sitio.nombre,
      url: sitio.url,
      info: sitio.info,
      pvp: sitio.pvp,
    });
    this.formulario.controls.dominio.disable();
    this.formularioVisible.set(true);
  }

  /** Sale del modo edición, limpia el formulario, vuelve a habilitar `dominio` y oculta el formulario, sin guardar cambios. */
  protected cancelarEdicion(): void {
    this.sitioEditandoDominio.set(null);
    this.formulario.reset({ dominio: '', nombre: '', url: '', info: false, pvp: false });
    this.formulario.controls.dominio.enable();
    this.formularioVisible.set(false);
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const valores = this.formulario.getRawValue();
    const dominioEditando = this.sitioEditandoDominio();
    const sitiosActuales = this.sitiosScrapingService.sitios();

    this.guardando.set(true);
    try {
      const resultado = dominioEditando
        ? await this.sitiosScrapingService.actualizarSitio(dominioEditando, {
            nombre: valores.nombre,
            url: valores.url,
            info: valores.info,
            pvp: valores.pvp,
            // La prioridad no se edita a mano: se reenvía sin cambios, solo el arrastre la modifica.
            prioridad: sitiosActuales.find((sitio) => sitio.dominio === dominioEditando)?.prioridad ?? 0,
          } satisfies DatosSitioScraping)
        : await this.sitiosScrapingService.crearSitio({
            ...valores,
            // Nueva fila: va al final de la cola de fallback.
            prioridad: sitiosActuales.reduce((maxima, sitio) => Math.max(maxima, sitio.prioridad), 0) + 1,
          });

      if (resultado.exito) {
        this.mensajeExito.set(
          dominioEditando ? 'Sitio de scraping actualizado correctamente.' : 'Sitio de scraping creado correctamente.',
        );
        this.sitioEditandoDominio.set(null);
        this.formulario.reset({ dominio: '', nombre: '', url: '', info: false, pvp: false });
        this.formulario.controls.dominio.enable();
        this.formularioVisible.set(false);
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Maneja el evento de soltar una fila arrastrada (`cdkDropListDropped`):
   * calcula el nuevo orden localmente con `moveItemInArray` y renumera
   * `prioridad` 1..N según la posición final. Solo persiste (vía
   * `actualizarSitio`) los sitios cuya `prioridad` efectivamente cambió,
   * en paralelo con `Promise.all` — se reporta error si alguna llamada
   * falla, y siempre se recarga la lista al final para reflejar el estado
   * real del backend (éxito parcial incluido).
   */
  protected async alSoltar(evento: CdkDragDrop<SitioScraping[]>): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (evento.previousIndex === evento.currentIndex) {
      return;
    }

    const nuevoOrden = [...this.sitios()];
    moveItemInArray(nuevoOrden, evento.previousIndex, evento.currentIndex);

    const cambios = nuevoOrden
      .map((sitio, indice) => ({ sitio, prioridad: indice + 1 }))
      .filter(({ sitio, prioridad }) => sitio.prioridad !== prioridad);

    if (cambios.length === 0) {
      return;
    }

    this.reordenando.set(true);
    try {
      const resultados = await Promise.all(
        cambios.map(({ sitio, prioridad }) =>
          this.sitiosScrapingService.actualizarSitio(sitio.dominio, {
            nombre: sitio.nombre,
            url: sitio.url,
            info: sitio.info,
            pvp: sitio.pvp,
            prioridad,
          } satisfies DatosSitioScraping),
        ),
      );

      if (resultados.some((resultado) => !resultado.exito)) {
        this.mensajeError.set('No se pudo guardar el nuevo orden de algunos sitios. Intenta de nuevo.');
      } else {
        this.mensajeExito.set('Orden actualizado correctamente.');
      }
    } finally {
      this.reordenando.set(false);
    }
  }

  protected async eliminar(sitio: SitioScraping): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar el sitio de scraping "${sitio.nombre}" (${sitio.dominio})?`)) {
      return;
    }

    this.eliminandoDominio.set(sitio.dominio);
    try {
      const resultado = await this.sitiosScrapingService.eliminarSitio(sitio.dominio);
      if (resultado.exito) {
        this.mensajeExito.set('Sitio de scraping eliminado correctamente.');
        if (this.sitioEditandoDominio() === sitio.dominio) {
          this.cancelarEdicion();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoDominio.set(null);
    }
  }
}
