import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EstantesService } from '../../core/api/estantes.service';

const PVP_MAXIMO = 5_000_000;

/**
 * Primer recorte vertical del flujo de catalogación (`TODO.md`, roadmap
 * Alta) — captura **manual** de todos los campos contra `POST /api/libros`,
 * ya verificado en vivo. El escaneo de ISBN con cámara y el autocompletado
 * de metadatos/PVP quedan para tareas futuras (extensiones independientes
 * de este mismo formulario).
 *
 * La validación del formulario es solo UX: `POST /api/libros` vuelve a
 * validar y recalcula `costo`/`utilidadCatalogo`/`bookId`/`creadoPor` en el
 * backend — este componente nunca envía ni confía en esos valores
 * (`CLAUDE.md` A08).
 */
@Component({
  selector: 'app-catalogar-libro',
  imports: [ReactiveFormsModule],
  templateUrl: './catalogar-libro.component.html',
})
export class CatalogarLibroComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly estantesService = inject(EstantesService);

  protected readonly estantes = this.estantesService.estantes;
  protected readonly errorEstantes = this.estantesService.error;

  protected readonly guardando = signal(false);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    isbn: [''],
    titulo: ['', Validators.required],
    autor: ['', Validators.required],
    editorial: [''],
    portadaUrl: [''],
    pvp: [0, [Validators.required, Validators.min(1), Validators.max(PVP_MAXIMO)]],
    porcentajeDescuentoEditorial: [35, [Validators.required, Validators.min(0), Validators.max(100)]],
    cantidadTotal: [1, [Validators.required, Validators.min(1)]],
    estanteId: ['', Validators.required],
  });

  ngOnInit(): void {
    void this.estantesService.cargarEstantes();
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const valores = this.formulario.getRawValue();
    const cuerpo = {
      isbn: valores.isbn.trim() === '' ? null : valores.isbn.trim(),
      titulo: valores.titulo,
      autor: valores.autor,
      editorial: valores.editorial.trim() === '' ? null : valores.editorial.trim(),
      portadaUrl: valores.portadaUrl.trim() === '' ? null : valores.portadaUrl.trim(),
      pvp: valores.pvp,
      porcentajeDescuentoEditorial: valores.porcentajeDescuentoEditorial,
      cantidadTotal: valores.cantidadTotal,
      estanteId: valores.estanteId,
    };

    this.guardando.set(true);
    try {
      const idToken = await this.authService.obtenerIdToken();
      if (!idToken) {
        this.mensajeError.set('No se pudo catalogar el libro. Intenta de nuevo.');
        return;
      }

      const libroCreado = await firstValueFrom(
        this.http.post<{ titulo: string }>('/api/libros', cuerpo, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );

      this.mensajeExito.set(`«${libroCreado.titulo}» catalogado correctamente.`);
      this.reiniciarFormulario();
    } catch (error) {
      const mensaje =
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'No se pudo catalogar el libro. Intenta de nuevo.';
      this.mensajeError.set(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Limpia el formulario tras un guardado exitoso, conservando
   * `porcentajeDescuentoEditorial` (típicamente el mismo entre libros
   * seguidos de la misma editorial) — agiliza la catalogación en serie.
   */
  private reiniciarFormulario(): void {
    const porcentajeActual = this.formulario.controls.porcentajeDescuentoEditorial.value;
    this.formulario.reset({
      isbn: '',
      titulo: '',
      autor: '',
      editorial: '',
      portadaUrl: '',
      pvp: 0,
      porcentajeDescuentoEditorial: porcentajeActual,
      cantidadTotal: 1,
      estanteId: '',
    });
  }
}
