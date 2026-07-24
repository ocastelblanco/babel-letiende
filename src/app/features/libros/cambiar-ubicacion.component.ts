import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { LibrosService } from '../../core/api/libros.service';

/**
 * Primer consumo desde el frontend de `PATCH /api/libros/:bookId/ubicacion`
 * — ruta `/libros/:bookId/ubicacion` (tech-specs.md §4.2), guardada solo con
 * `AuthGuard` (no `RoleGuard`): tanto `vendedor` como `administrador` pueden
 * mover un libro de ubicación, mismo criterio que `/libros`.
 *
 * Placeholder mínimo (`TODO.md` Tarea 1, paso 4): reemplaza a
 * `CambiarEstanteComponent`, mismo flujo pero con un select de `Ubicacion`
 * (`UbicacionFisicaService`, sin cascada Espacio→Mueble todavía — esa
 * mejora de UX es la Tarea E) en vez del antiguo select de `Estante`.
 *
 * No existe un endpoint de detalle por `bookId` — el libro actual se
 * resuelve del mismo catálogo público que ya consume `ListaLibrosCatalogadosComponent`
 * (`LibrosService`, `GET /api/libros`), evitando agregar un endpoint nuevo
 * solo para esta pantalla. Si el `bookId` no aparece en el catálogo (ej. ya
 * no tiene ejemplares disponibles) se muestra un mensaje en vez de un
 * formulario roto.
 */
@Component({
  selector: 'app-cambiar-ubicacion',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cambiar-ubicacion.component.html',
})
export class CambiarUbicacionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);
  private readonly librosService = inject(LibrosService);

  protected readonly bookId = this.route.snapshot.paramMap.get('bookId') ?? '';

  protected readonly ubicaciones = this.ubicacionFisicaService.ubicaciones;
  protected readonly errorUbicaciones = this.ubicacionFisicaService.errorUbicaciones;

  protected readonly cargandoLibro = this.librosService.cargando;
  protected readonly libro = computed(() => this.librosService.libros().find((l) => l.bookId === this.bookId));

  protected readonly guardando = signal(false);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    ubicacionId: ['', Validators.required],
  });

  ngOnInit(): void {
    void this.ubicacionFisicaService.cargarUbicaciones();
    void this.librosService.cargarCatalogo().then(() => {
      const libro = this.libro();
      if (libro) {
        this.formulario.controls.ubicacionId.setValue(libro.ubicacionId);
      }
    });
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.guardando.set(true);
    try {
      const idToken = await this.authService.obtenerIdToken();
      if (!idToken) {
        this.mensajeError.set('No se pudo cambiar la ubicación. Intenta de nuevo.');
        return;
      }

      await firstValueFrom(
        this.http.patch(
          `/api/libros/${this.bookId}/ubicacion`,
          { ubicacionId: this.formulario.getRawValue().ubicacionId },
          { headers: { Authorization: `Bearer ${idToken}` } },
        ),
      );

      this.mensajeExito.set('Ubicación actualizada correctamente.');
    } catch (error) {
      const mensaje =
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'No se pudo cambiar la ubicación. Intenta de nuevo.';
      this.mensajeError.set(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }
}
