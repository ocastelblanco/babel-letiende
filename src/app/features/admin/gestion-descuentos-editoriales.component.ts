import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import {
  DatosDescuentoEditorial,
  DatosNuevoDescuentoEditorial,
  EditorialesDescuentosService,
} from '../../core/api/editoriales-descuentos.service';
import { DescuentoEditorial } from '../../core/models/descuento-editorial.model';

/** Separa el input de texto de `porcentajesDisponibles` en segmentos no vacíos, recortando espacios — ej. `"35,  40 ,45"` -> `["35", "40", "45"]`. */
function segmentarPorcentajes(valor: string): string[] {
  return valor
    .split(',')
    .map((segmento) => segmento.trim())
    .filter((segmento) => segmento !== '');
}

/**
 * Valida el control `porcentajesDisponibles` (input de texto, números
 * separados por coma — ej. "35, 40, 45", único patrón previo en el proyecto
 * para "array editable en un formulario reactivo", ver `TODO.md` Tarea 1).
 * Cadena vacía es válida (se traduce en `[]`, permitido por el backend);
 * cualquier segmento que no sea un número entre 0 y 100 marca el control
 * inválido con `porcentajesInvalidos`.
 */
function validadorPorcentajesDisponibles(control: AbstractControl<string>): ValidationErrors | null {
  const invalido = segmentarPorcentajes(control.value).some((segmento) => {
    const numero = Number(segmento);
    return !Number.isFinite(numero) || numero < 0 || numero > 100;
  });
  return invalido ? { porcentajesInvalidos: true } : null;
}

/** Parsea el input de texto de `porcentajesDisponibles` a `number[]` — usar solo tras confirmar que el control es válido (`validadorPorcentajesDisponibles`). */
function parsearPorcentajesDisponibles(valor: string): number[] {
  return segmentarPorcentajes(valor).map(Number);
}

/**
 * Ruta protegida `/admin/editoriales` (`RoleGuard('administrador')`,
 * `PRD.md` §5.6, `TODO.md` Tarea 1) — CRUD de configuración de descuentos por
 * editorial. Un único formulario reactivo se reutiliza para crear y editar:
 * `editorialEditando` distingue el modo (`null` = crear, una `editorial` =
 * editando esa fila) — mismo patrón que `GestionUsuariosComponent`. La
 * `editorial` es la clave primaria suministrada por el administrador al
 * crear, así que su control se deshabilita al editar (no se puede cambiar
 * la clave de una fila existente). La autorización real la vuelve a
 * verificar siempre `EditorialesDescuentosService`/el backend (`CLAUDE.md`
 * A01) — este componente nunca decide por sí mismo si el usuario puede
 * escribir.
 *
 * Nota: el 100% (libro propio de Le Tiende, sin consignación) es siempre una
 * opción implícita al catalogar, independiente de lo que haya en este CRUD —
 * no se modela aquí (ver `descuento-editorial.model.ts`).
 */
@Component({
  selector: 'app-gestion-descuentos-editoriales',
  imports: [ReactiveFormsModule],
  templateUrl: './gestion-descuentos-editoriales.component.html',
})
export class GestionDescuentosEditorialesComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly descuentosService = inject(EditorialesDescuentosService);

  protected readonly errorCarga = this.descuentosService.error;
  protected readonly descuentos = this.descuentosService.descuentos;

  protected readonly guardando = signal(false);
  protected readonly eliminandoEditorial = signal<string | null>(null);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** Controla si el formulario de creación/edición está desplegado — oculto por defecto. */
  protected readonly formularioVisible = signal(false);

  /** `null` mientras se crea un descuento nuevo; la `editorial` de la fila mientras se edita. */
  protected readonly editorialEditando = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    editorial: ['', Validators.required],
    porcentajePorDefecto: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    porcentajesDisponibles: ['', validadorPorcentajesDisponibles],
  });

  ngOnInit(): void {
    void this.descuentosService.cargarDescuentos();
  }

  /** Limpia cualquier estado de edición previo y abre el formulario vacío en modo "crear". */
  protected agregar(): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.editorialEditando.set(null);
    this.formulario.reset({ editorial: '', porcentajePorDefecto: 0, porcentajesDisponibles: '' });
    this.formulario.controls.editorial.enable();
    this.formularioVisible.set(true);
  }

  /** Precarga el formulario con los datos de la fila, deshabilita `editorial` (clave primaria, no editable) y entra en modo edición. */
  protected editar(descuento: DescuentoEditorial): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.editorialEditando.set(descuento.editorial);
    this.formulario.setValue({
      editorial: descuento.editorial,
      porcentajePorDefecto: descuento.porcentajePorDefecto,
      porcentajesDisponibles: descuento.porcentajesDisponibles.join(', '),
    });
    this.formulario.controls.editorial.disable();
    this.formularioVisible.set(true);
  }

  /** Sale del modo edición, limpia el formulario, vuelve a habilitar `editorial` y oculta el formulario, sin guardar cambios. */
  protected cancelarEdicion(): void {
    this.editorialEditando.set(null);
    this.formulario.reset({ editorial: '', porcentajePorDefecto: 0, porcentajesDisponibles: '' });
    this.formulario.controls.editorial.enable();
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
    const editorialEditando = this.editorialEditando();
    const datos: DatosDescuentoEditorial = {
      porcentajePorDefecto: valores.porcentajePorDefecto,
      porcentajesDisponibles: parsearPorcentajesDisponibles(valores.porcentajesDisponibles),
    };

    this.guardando.set(true);
    try {
      const resultado = editorialEditando
        ? await this.descuentosService.actualizarDescuento(editorialEditando, datos)
        : await this.descuentosService.crearDescuento({
            editorial: valores.editorial,
            ...datos,
          } satisfies DatosNuevoDescuentoEditorial);

      if (resultado.exito) {
        this.mensajeExito.set(
          editorialEditando
            ? 'Descuento editorial actualizado correctamente.'
            : 'Descuento editorial creado correctamente.',
        );
        this.editorialEditando.set(null);
        this.formulario.reset({ editorial: '', porcentajePorDefecto: 0, porcentajesDisponibles: '' });
        this.formulario.controls.editorial.enable();
        this.formularioVisible.set(false);
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(descuento: DescuentoEditorial): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar el descuento editorial de "${descuento.editorial}"?`)) {
      return;
    }

    this.eliminandoEditorial.set(descuento.editorial);
    try {
      const resultado = await this.descuentosService.eliminarDescuento(descuento.editorial);
      if (resultado.exito) {
        this.mensajeExito.set('Descuento editorial eliminado correctamente.');
        if (this.editorialEditando() === descuento.editorial) {
          this.cancelarEdicion();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoEditorial.set(null);
    }
  }
}
