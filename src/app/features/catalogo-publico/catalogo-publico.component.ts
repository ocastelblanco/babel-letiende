import { Component, OnInit, inject } from '@angular/core';
import { LibrosService } from '../../core/api/libros.service';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';

/**
 * Catálogo público de consulta (tech-specs.md §4.2, ruta `/`, sin
 * autenticación). Sin filtros de texto/autor/tema todavía (fuera de alcance,
 * ver `TODO.md`).
 */
@Component({
  selector: 'app-catalogo-publico',
  imports: [PvpPipe],
  templateUrl: './catalogo-publico.component.html',
})
export class CatalogoPublicoComponent implements OnInit {
  private readonly librosService = inject(LibrosService);

  protected readonly libros = this.librosService.libros;
  protected readonly cargando = this.librosService.cargando;
  protected readonly error = this.librosService.error;

  ngOnInit(): void {
    void this.librosService.cargarCatalogo();
  }
}
