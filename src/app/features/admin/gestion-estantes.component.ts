import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatosEstante, EstantesService } from '../../core/api/estantes.service';
import { Estante } from '../../core/models/estante.model';

/**
 * Ruta protegida `/admin/estantes` (`RoleGuard('administrador')`,
 * `tech-specs.md` §4.2) — primer CRUD real de administración
 * (`TODO.md`, Tarea 2). Un único formulario reactivo se reutiliza para
 * crear y editar: `estanteEditandoId` distingue el modo (`null` = crear,
 * un `estanteId` = editando esa fila). La autorización real la vuelve a
 * verificar siempre `EstantesService`/el backend (`CLAUDE.md` A01) — este
 * componente nunca decide por sí mismo si el usuario puede escribir.
 */
@Component({
  selector: 'app-gestion-estantes',
  imports: [ReactiveFormsModule],
  templateUrl: './gestion-estantes.component.html',
})
export class GestionEstantesComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly estantesService = inject(EstantesService);

  protected readonly estantes = this.estantesService.estantes;
  protected readonly errorCarga = this.estantesService.error;

  protected readonly guardando = signal(false);
  protected readonly eliminandoId = signal<string | null>(null);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** `null` mientras se crea un estante nuevo; el `estanteId` de la fila mientras se edita. */
  protected readonly estanteEditandoId = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    espacio: ['', Validators.required],
    mueble: ['', Validators.required],
    ubicacion: ['', Validators.required],
  });

  ngOnInit(): void {
    void this.estantesService.cargarEstantes();
  }

  /** Precarga el formulario con los datos de la fila y entra en modo edición. */
  protected editar(estante: Estante): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.estanteEditandoId.set(estante.estanteId);
    this.formulario.setValue({
      espacio: estante.espacio,
      mueble: estante.mueble,
      ubicacion: estante.ubicacion,
    });
  }

  /** Sale del modo edición y limpia el formulario, sin guardar cambios. */
  protected cancelarEdicion(): void {
    this.estanteEditandoId.set(null);
    this.formulario.reset({ espacio: '', mueble: '', ubicacion: '' });
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const datos: DatosEstante = this.formulario.getRawValue();
    const estanteId = this.estanteEditandoId();

    this.guardando.set(true);
    try {
      const resultado = estanteId
        ? await this.estantesService.actualizarEstante(estanteId, datos)
        : await this.estantesService.crearEstante(datos);

      if (resultado.exito) {
        this.mensajeExito.set(estanteId ? 'Estante actualizado correctamente.' : 'Estante creado correctamente.');
        this.estanteEditandoId.set(null);
        this.formulario.reset({ espacio: '', mueble: '', ubicacion: '' });
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(estante: Estante): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar el estante "${estante.espacio} — ${estante.mueble} — ${estante.ubicacion}"?`)) {
      return;
    }

    this.eliminandoId.set(estante.estanteId);
    try {
      const resultado = await this.estantesService.eliminarEstante(estante.estanteId);
      if (resultado.exito) {
        this.mensajeExito.set('Estante eliminado correctamente.');
        if (this.estanteEditandoId() === estante.estanteId) {
          this.cancelarEdicion();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoId.set(null);
    }
  }
}
