import { Component, OnInit, inject, signal } from '@angular/core';
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
 */
@Component({
  selector: 'app-gestion-sitios-scraping',
  imports: [ReactiveFormsModule],
  templateUrl: './gestion-sitios-scraping.component.html',
})
export class GestionSitiosScrapingComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly sitiosScrapingService = inject(SitiosScrapingService);

  protected readonly sitios = this.sitiosScrapingService.sitios;
  protected readonly errorCarga = this.sitiosScrapingService.error;

  protected readonly guardando = signal(false);
  protected readonly eliminandoDominio = signal<string | null>(null);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** `null` mientras se crea un sitio nuevo; el `dominio` de la fila mientras se edita. */
  protected readonly sitioEditandoDominio = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    dominio: ['', Validators.required],
    nombre: ['', Validators.required],
    url: ['', Validators.required],
    info: [false],
    pvp: [false],
    prioridad: [0, Validators.required],
  });

  ngOnInit(): void {
    void this.sitiosScrapingService.cargarSitios();
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
      prioridad: sitio.prioridad,
    });
    this.formulario.controls.dominio.disable();
  }

  /** Sale del modo edición, limpia el formulario y vuelve a habilitar `dominio`, sin guardar cambios. */
  protected cancelarEdicion(): void {
    this.sitioEditandoDominio.set(null);
    this.formulario.reset({ dominio: '', nombre: '', url: '', info: false, pvp: false, prioridad: 0 });
    this.formulario.controls.dominio.enable();
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

    this.guardando.set(true);
    try {
      const resultado = dominioEditando
        ? await this.sitiosScrapingService.actualizarSitio(dominioEditando, {
            nombre: valores.nombre,
            url: valores.url,
            info: valores.info,
            pvp: valores.pvp,
            prioridad: valores.prioridad,
          } satisfies DatosSitioScraping)
        : await this.sitiosScrapingService.crearSitio(valores);

      if (resultado.exito) {
        this.mensajeExito.set(
          dominioEditando ? 'Sitio de scraping actualizado correctamente.' : 'Sitio de scraping creado correctamente.',
        );
        this.sitioEditandoDominio.set(null);
        this.formulario.reset({ dominio: '', nombre: '', url: '', info: false, pvp: false, prioridad: 0 });
        this.formulario.controls.dominio.enable();
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardando.set(false);
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
