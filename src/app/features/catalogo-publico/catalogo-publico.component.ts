import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';

/** Quita tildes y normaliza mayúsculas para que la búsqueda encuentre "garcia" al buscar "García". */
function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Catálogo público de consulta (tech-specs.md §4.2, ruta `/`, sin
 * autenticación). Filtro por título/autor/ISBN resuelto en el CLIENTE, sobre
 * el `libros()` signal que `LibrosService` ya carga completo desde
 * `GET /api/libros` (TODO.md, búsqueda y filtro en el catálogo público) —
 * decisión deliberada, no backend: DynamoDB (`escanearMayorQue`, un `Scan`
 * completo de la tabla) no soporta bien texto libre, así que un filtro en el
 * backend no reduciría el costo del `Scan`, solo el tamaño de la respuesta;
 * y el catálogo ya se carga completo hoy (sin paginación) para el listado
 * sin filtro, así que filtrar en el cliente no agrega ninguna petición
 * nueva. "Tema" (mencionado en PRD.md §5.7) no existe como campo en el
 * modelo `Libro` — confirmado que los metadatos de Google Books vía
 * `api.letiende.co` no lo traen (ver tarea de autocompletado por ISBN) — el
 * alcance real es título/autor/ISBN. El volumen del payload completo
 * (3.000+ libros en una sola respuesta, sin paginar) es una característica
 * previa de `GET /api/libros`, no algo que introduzca esta tarea — queda
 * fuera de este alcance, para resolver aparte si en producción resulta ser
 * un problema real de rendimiento.
 */
@Component({
  selector: 'app-catalogo-publico',
  imports: [PvpPipe, RouterLink],
  templateUrl: './catalogo-publico.component.html',
})
export class CatalogoPublicoComponent implements OnInit {
  private readonly librosService = inject(LibrosService);

  protected readonly libros = this.librosService.libros;
  protected readonly cargando = this.librosService.cargando;
  protected readonly error = this.librosService.error;

  protected readonly terminoBusqueda = signal('');

  protected readonly librosFiltrados = computed(() => {
    const termino = normalizarTexto(this.terminoBusqueda());
    const libros = this.libros();
    if (termino === '') {
      return libros;
    }
    return libros.filter((libro) => {
      const campos = [libro.titulo, libro.autor, libro.isbn ?? ''];
      return campos.some((campo) => normalizarTexto(campo).includes(termino));
    });
  });

  ngOnInit(): void {
    void this.librosService.cargarCatalogo();
  }
}
