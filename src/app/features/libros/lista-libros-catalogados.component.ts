import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';

/**
 * Ruta protegida /libros (tech-specs.md §4.2, `AuthGuard`). Reutiliza
 * `LibrosService` (el mismo catálogo público que consume `/`) para listar
 * los libros ya catalogados — no es una gestión completa de inventario
 * (eso queda para una tarea de roadmap separada), solo el punto de
 * navegación mínimo para llegar a `CambiarEstanteComponent` desde un libro
 * concreto. También enlaza a `/catalogar`.
 */
@Component({
  selector: 'app-lista-libros-catalogados',
  imports: [RouterLink],
  templateUrl: './lista-libros-catalogados.component.html',
})
export class ListaLibrosCatalogadosComponent implements OnInit {
  private readonly librosService = inject(LibrosService);

  protected readonly libros = this.librosService.libros;
  protected readonly cargando = this.librosService.cargando;
  protected readonly error = this.librosService.error;

  ngOnInit(): void {
    void this.librosService.cargarCatalogo();
  }
}
