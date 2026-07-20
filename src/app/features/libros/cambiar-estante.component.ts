import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EstantesService } from '../../core/api/estantes.service';
import { LibrosService } from '../../core/api/libros.service';

/**
 * Primer consumo desde el frontend de `PATCH /api/libros/:bookId/estante`
 * (ya verificado en vivo, `TODO.md` histórico) — ruta `/libros/:bookId/estante`
 * (tech-specs.md §4.2), guardada solo con `AuthGuard` (no `RoleGuard`): tanto
 * `vendedor` como `administrador` pueden mover un libro de estante, mismo
 * criterio que `/libros`.
 *
 * No existe un endpoint de detalle por `bookId` — el libro actual se
 * resuelve del mismo catálogo público que ya consume `ListaLibrosCatalogadosComponent`
 * (`LibrosService`, `GET /api/libros`), evitando agregar un endpoint nuevo
 * solo para esta pantalla. Si el `bookId` no aparece en el catálogo (ej. ya
 * no tiene ejemplares disponibles) se muestra un mensaje en vez de un
 * formulario roto.
 */
@Component({
  selector: 'app-cambiar-estante',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cambiar-estante.component.html',
})
export class CambiarEstanteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly estantesService = inject(EstantesService);
  private readonly librosService = inject(LibrosService);

  protected readonly bookId = this.route.snapshot.paramMap.get('bookId') ?? '';

  protected readonly estantes = this.estantesService.estantes;
  protected readonly errorEstantes = this.estantesService.error;

  protected readonly cargandoLibro = this.librosService.cargando;
  protected readonly libro = computed(() => this.librosService.libros().find((l) => l.bookId === this.bookId));

  protected readonly guardando = signal(false);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    estanteId: ['', Validators.required],
  });

  ngOnInit(): void {
    void this.estantesService.cargarEstantes();
    void this.librosService.cargarCatalogo().then(() => {
      const libro = this.libro();
      if (libro) {
        this.formulario.controls.estanteId.setValue(libro.estanteId);
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
        this.mensajeError.set('No se pudo cambiar el estante. Intenta de nuevo.');
        return;
      }

      await firstValueFrom(
        this.http.patch(
          `/api/libros/${this.bookId}/estante`,
          { estanteId: this.formulario.getRawValue().estanteId },
          { headers: { Authorization: `Bearer ${idToken}` } },
        ),
      );

      this.mensajeExito.set('Estante actualizado correctamente.');
    } catch (error) {
      const mensaje =
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'No se pudo cambiar el estante. Intenta de nuevo.';
      this.mensajeError.set(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }
}
