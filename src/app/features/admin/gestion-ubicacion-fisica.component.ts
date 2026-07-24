import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DatosEspacio,
  DatosMueble,
  DatosUbicacion,
  UbicacionFisicaService,
} from '../../core/api/ubicacion-fisica.service';
import { Espacio } from '../../core/models/espacio.model';
import { Mueble } from '../../core/models/mueble.model';
import { Ubicacion } from '../../core/models/ubicacion.model';

type Pestaña = 'espacios' | 'muebles' | 'ubicaciones';

/**
 * Ruta protegida `/admin/ubicaciones` (`RoleGuard('administrador')`,
 * `TODO.md` Tarea 2) — CRUD del modelo jerárquico de ubicación física
 * Espacio → Mueble → Ubicación, que eventualmente reemplaza a
 * `GestionEstantesComponent`/`/admin/estantes` (esa migración es una tarea
 * futura separada: `EstantesService`/`estantes.ts` siguen en uso sin
 * cambios por `CatalogarLibroComponent`/`CambiarEstanteComponent`).
 *
 * 3 pestañas independientes (`pestanaActiva`), cada una con su propio
 * formulario único crear/editar oculto por defecto (`DESIGN.md` §4,
 * establecido por `GestionSitiosScrapingComponent`): un signal
 * `[entidad]EditandoId` distingue el modo. La autorización real la vuelve a
 * verificar siempre `UbicacionFisicaService`/el backend (`CLAUDE.md` A01) —
 * este componente nunca decide por sí mismo si el usuario puede escribir.
 *
 * Pestaña "Muebles": el `<select>` de Espacio es obligatorio (todo mueble
 * pertenece a un espacio). Pestaña "Ubicaciones": el `<select>` de Espacio
 * es solo un filtro de ayuda (no se envía al backend, que solo guarda
 * `muebleId`) — al cambiarlo se recalculan las opciones del `<select>` de
 * Mueble y se limpia la selección previa (cascada,
 * `alCambiarEspacioEnFormularioUbicacion`).
 */
@Component({
  selector: 'app-gestion-ubicacion-fisica',
  imports: [ReactiveFormsModule],
  templateUrl: './gestion-ubicacion-fisica.component.html',
})
export class GestionUbicacionFisicaComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);

  protected readonly pestanaActiva = signal<Pestaña>('espacios');

  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly errorCargaEspacios = this.ubicacionFisicaService.errorEspacios;
  protected readonly muebles = this.ubicacionFisicaService.muebles;
  protected readonly errorCargaMuebles = this.ubicacionFisicaService.errorMuebles;
  protected readonly ubicaciones = this.ubicacionFisicaService.ubicaciones;
  protected readonly errorCargaUbicaciones = this.ubicacionFisicaService.errorUbicaciones;

  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  // ---------------------------------------------------------------------
  // Espacios
  // ---------------------------------------------------------------------

  protected readonly guardandoEspacio = signal(false);
  protected readonly eliminandoEspacioId = signal<string | null>(null);
  protected readonly formularioEspacioVisible = signal(false);
  protected readonly espacioEditandoId = signal<string | null>(null);
  protected readonly formularioEspacio = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
  });

  // ---------------------------------------------------------------------
  // Muebles
  // ---------------------------------------------------------------------

  protected readonly guardandoMueble = signal(false);
  protected readonly eliminandoMuebleId = signal<string | null>(null);
  protected readonly formularioMuebleVisible = signal(false);
  protected readonly muebleEditandoId = signal<string | null>(null);
  protected readonly formularioMueble = this.fb.nonNullable.group({
    espacioId: ['', Validators.required],
    nombre: ['', Validators.required],
  });

  // ---------------------------------------------------------------------
  // Ubicaciones
  // ---------------------------------------------------------------------

  protected readonly guardandoUbicacion = signal(false);
  protected readonly eliminandoUbicacionId = signal<string | null>(null);
  protected readonly formularioUbicacionVisible = signal(false);
  protected readonly ubicacionEditandoId = signal<string | null>(null);
  /** Espacio elegido en el formulario de Ubicaciones — solo filtra el `<select>` de Mueble, no se envía al backend. */
  protected readonly espacioIdSeleccionadoUbicacion = signal('');
  protected readonly formularioUbicacion = this.fb.nonNullable.group({
    espacioId: ['', Validators.required],
    muebleId: ['', Validators.required],
    nombre: ['', Validators.required],
  });

  /** Muebles del espacio elegido en el formulario de Ubicaciones (cascada Espacio → Mueble). */
  protected readonly mueblesDelEspacioSeleccionado = computed(() =>
    this.muebles().filter((mueble) => mueble.espacioId === this.espacioIdSeleccionadoUbicacion()),
  );

  ngOnInit(): void {
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();
  }

  protected cambiarPestana(pestaña: Pestaña): void {
    this.pestanaActiva.set(pestaña);
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
  }

  /** Nombre del espacio dado su id, para mostrar a qué espacio pertenece un mueble en la lista. */
  protected nombreEspacio(espacioId: string): string {
    return this.espacios().find((espacio) => espacio.espacioId === espacioId)?.nombre ?? 'Espacio desconocido';
  }

  /** Nombre del mueble dado su id, para mostrar a qué mueble pertenece una ubicación en la lista. */
  protected nombreMueble(muebleId: string): string {
    return this.muebles().find((mueble) => mueble.muebleId === muebleId)?.nombre ?? 'Mueble desconocido';
  }

  /** Nombre del espacio al que pertenece una ubicación, resuelto vía su mueble. */
  protected nombreEspacioDeUbicacion(muebleId: string): string {
    const mueble = this.muebles().find((mueble) => mueble.muebleId === muebleId);
    return mueble ? this.nombreEspacio(mueble.espacioId) : 'Espacio desconocido';
  }

  // ---------------------------------------------------------------------
  // Espacios
  // ---------------------------------------------------------------------

  protected agregarEspacio(): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.espacioEditandoId.set(null);
    this.formularioEspacio.reset({ nombre: '' });
    this.formularioEspacioVisible.set(true);
  }

  protected editarEspacio(espacio: Espacio): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.espacioEditandoId.set(espacio.espacioId);
    this.formularioEspacio.setValue({ nombre: espacio.nombre });
    this.formularioEspacioVisible.set(true);
  }

  protected cancelarEdicionEspacio(): void {
    this.espacioEditandoId.set(null);
    this.formularioEspacio.reset({ nombre: '' });
    this.formularioEspacioVisible.set(false);
  }

  protected async guardarEspacio(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formularioEspacio.invalid) {
      this.formularioEspacio.markAllAsTouched();
      return;
    }

    const datos: DatosEspacio = this.formularioEspacio.getRawValue();
    const idEditando = this.espacioEditandoId();

    this.guardandoEspacio.set(true);
    try {
      const resultado = idEditando
        ? await this.ubicacionFisicaService.actualizarEspacio(idEditando, datos)
        : await this.ubicacionFisicaService.crearEspacio(datos);

      if (resultado.exito) {
        this.mensajeExito.set(idEditando ? 'Espacio actualizado correctamente.' : 'Espacio creado correctamente.');
        this.cancelarEdicionEspacio();
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardandoEspacio.set(false);
    }
  }

  protected async eliminarEspacio(espacio: Espacio): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar el espacio "${espacio.nombre}"?`)) {
      return;
    }

    this.eliminandoEspacioId.set(espacio.espacioId);
    try {
      const resultado = await this.ubicacionFisicaService.eliminarEspacio(espacio.espacioId);
      if (resultado.exito) {
        this.mensajeExito.set('Espacio eliminado correctamente.');
        if (this.espacioEditandoId() === espacio.espacioId) {
          this.cancelarEdicionEspacio();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoEspacioId.set(null);
    }
  }

  // ---------------------------------------------------------------------
  // Muebles
  // ---------------------------------------------------------------------

  protected agregarMueble(): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.muebleEditandoId.set(null);
    this.formularioMueble.reset({ espacioId: '', nombre: '' });
    this.formularioMuebleVisible.set(true);
  }

  protected editarMueble(mueble: Mueble): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.muebleEditandoId.set(mueble.muebleId);
    this.formularioMueble.setValue({ espacioId: mueble.espacioId, nombre: mueble.nombre });
    this.formularioMuebleVisible.set(true);
  }

  protected cancelarEdicionMueble(): void {
    this.muebleEditandoId.set(null);
    this.formularioMueble.reset({ espacioId: '', nombre: '' });
    this.formularioMuebleVisible.set(false);
  }

  protected async guardarMueble(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formularioMueble.invalid) {
      this.formularioMueble.markAllAsTouched();
      return;
    }

    const datos: DatosMueble = this.formularioMueble.getRawValue();
    const idEditando = this.muebleEditandoId();

    this.guardandoMueble.set(true);
    try {
      const resultado = idEditando
        ? await this.ubicacionFisicaService.actualizarMueble(idEditando, datos)
        : await this.ubicacionFisicaService.crearMueble(datos);

      if (resultado.exito) {
        this.mensajeExito.set(idEditando ? 'Mueble actualizado correctamente.' : 'Mueble creado correctamente.');
        this.cancelarEdicionMueble();
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardandoMueble.set(false);
    }
  }

  protected async eliminarMueble(mueble: Mueble): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar el mueble "${mueble.nombre}"?`)) {
      return;
    }

    this.eliminandoMuebleId.set(mueble.muebleId);
    try {
      const resultado = await this.ubicacionFisicaService.eliminarMueble(mueble.muebleId);
      if (resultado.exito) {
        this.mensajeExito.set('Mueble eliminado correctamente.');
        if (this.muebleEditandoId() === mueble.muebleId) {
          this.cancelarEdicionMueble();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoMuebleId.set(null);
    }
  }

  // ---------------------------------------------------------------------
  // Ubicaciones
  // ---------------------------------------------------------------------

  protected agregarUbicacion(): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.ubicacionEditandoId.set(null);
    this.espacioIdSeleccionadoUbicacion.set('');
    this.formularioUbicacion.reset({ espacioId: '', muebleId: '', nombre: '' });
    this.formularioUbicacionVisible.set(true);
  }

  protected editarUbicacion(ubicacion: Ubicacion): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.ubicacionEditandoId.set(ubicacion.ubicacionId);
    const mueble = this.muebles().find((mueble) => mueble.muebleId === ubicacion.muebleId);
    const espacioId = mueble?.espacioId ?? '';
    this.espacioIdSeleccionadoUbicacion.set(espacioId);
    this.formularioUbicacion.setValue({ espacioId, muebleId: ubicacion.muebleId, nombre: ubicacion.nombre });
    this.formularioUbicacionVisible.set(true);
  }

  protected cancelarEdicionUbicacion(): void {
    this.ubicacionEditandoId.set(null);
    this.espacioIdSeleccionadoUbicacion.set('');
    this.formularioUbicacion.reset({ espacioId: '', muebleId: '', nombre: '' });
    this.formularioUbicacionVisible.set(false);
  }

  /** Cambiar el Espacio en el formulario de Ubicaciones recalcula las opciones de Mueble y limpia la selección previa (cascada). */
  protected alCambiarEspacioEnFormularioUbicacion(): void {
    this.espacioIdSeleccionadoUbicacion.set(this.formularioUbicacion.controls.espacioId.value);
    this.formularioUbicacion.controls.muebleId.setValue('');
  }

  protected async guardarUbicacion(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formularioUbicacion.invalid) {
      this.formularioUbicacion.markAllAsTouched();
      return;
    }

    const valores = this.formularioUbicacion.getRawValue();
    const datos: DatosUbicacion = { nombre: valores.nombre, muebleId: valores.muebleId };
    const idEditando = this.ubicacionEditandoId();

    this.guardandoUbicacion.set(true);
    try {
      const resultado = idEditando
        ? await this.ubicacionFisicaService.actualizarUbicacion(idEditando, datos)
        : await this.ubicacionFisicaService.crearUbicacion(datos);

      if (resultado.exito) {
        this.mensajeExito.set(idEditando ? 'Ubicación actualizada correctamente.' : 'Ubicación creada correctamente.');
        this.cancelarEdicionUbicacion();
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardandoUbicacion.set(false);
    }
  }

  protected async eliminarUbicacion(ubicacion: Ubicacion): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar la ubicación "${ubicacion.nombre}"?`)) {
      return;
    }

    this.eliminandoUbicacionId.set(ubicacion.ubicacionId);
    try {
      const resultado = await this.ubicacionFisicaService.eliminarUbicacion(ubicacion.ubicacionId);
      if (resultado.exito) {
        this.mensajeExito.set('Ubicación eliminada correctamente.');
        if (this.ubicacionEditandoId() === ubicacion.ubicacionId) {
          this.cancelarEdicionUbicacion();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoUbicacionId.set(null);
    }
  }
}
