import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';

/** Título de pestaña del catálogo público — mismo texto en todo momento (ver `ngOnInit`). */
export const TITULO_CATALOGO_PUBLICO = 'Inicio - Catálogo público';

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
 *
 * Filtro por ubicación (`ajustes-finales.md` Tarea F): 2 `<select>` de
 * Espacio/Mueble, acumulativos entre sí y con la búsqueda de texto — mismo
 * criterio "todo en el cliente" de arriba, reutilizando `UbicacionFisicaService`
 * (endpoints públicos `GET /api/espacios`/`GET /api/muebles`/`GET /api/ubicaciones`,
 * ya usados por `/admin/ubicaciones`). Un libro se resuelve a su Mueble/Espacio
 * siguiendo `Libro.ubicacionId → Ubicacion.muebleId → Mueble.espacioId` con 2
 * `Map` en memoria (sin llamada nueva por libro). Soporta query params
 * `?espacio=<espacioId>&mueble=<muebleId>` para pre-filtrar al entrar
 * (caso de uso QR, `ajustes-finales.md`: solo la URL filtrable, no la imagen
 * del código) — cambiar un `<select>` actualiza la URL (`replaceUrl`, no
 * ensucia el historial en cada cambio de filtro).
 */
@Component({
  selector: 'app-catalogo-publico',
  imports: [PvpPipe, RouterLink],
  templateUrl: './catalogo-publico.component.html',
})
export class CatalogoPublicoComponent implements OnInit {
  private readonly librosService = inject(LibrosService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);
  private readonly title = inject(Title);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly libros = this.librosService.libros;
  protected readonly cargando = this.librosService.cargando;
  protected readonly error = this.librosService.error;

  protected readonly terminoBusqueda = signal('');

  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly espacioSeleccionado = signal('');
  protected readonly muebleSeleccionado = signal('');

  /** Muebles del `<select>` dependiente: todos si no hay Espacio elegido, filtrados por `espacioId` si sí. */
  protected readonly mueblesFiltrados = computed(() => {
    const espacioId = this.espacioSeleccionado();
    const muebles = this.ubicacionFisicaService.muebles();
    return espacioId === '' ? muebles : muebles.filter((mueble) => mueble.espacioId === espacioId);
  });

  protected readonly librosFiltrados = computed(() => {
    const termino = normalizarTexto(this.terminoBusqueda());
    const espacioId = this.espacioSeleccionado();
    const muebleId = this.muebleSeleccionado();
    const ubicaciones = this.ubicacionFisicaService.ubicaciones();
    const muebles = this.ubicacionFisicaService.muebles();

    const muebleDeUbicacion = new Map(ubicaciones.map((ubicacion) => [ubicacion.ubicacionId, ubicacion.muebleId]));
    const espacioDeMueble = new Map(muebles.map((mueble) => [mueble.muebleId, mueble.espacioId]));

    return this.libros().filter((libro) => {
      if (termino !== '') {
        const campos = [libro.titulo, libro.autor, libro.isbn ?? ''];
        if (!campos.some((campo) => normalizarTexto(campo).includes(termino))) {
          return false;
        }
      }

      if (muebleId !== '') {
        if (muebleDeUbicacion.get(libro.ubicacionId) !== muebleId) {
          return false;
        }
      } else if (espacioId !== '') {
        const libroMuebleId = muebleDeUbicacion.get(libro.ubicacionId);
        if (!libroMuebleId || espacioDeMueble.get(libroMuebleId) !== espacioId) {
          return false;
        }
      }

      return true;
    });
  });

  ngOnInit(): void {
    // `Title` es un servicio singleton — `LibroDetalleComponent` lo
    // sobreescribe con el título del libro visitado y nunca lo restaura, así
    // que hay que resetearlo explícitamente al entrar aquí (TODO.md, fixes
    // rápidos del catálogo público). Sin esto, el título de pestaña queda
    // pegado al último libro visitado al volver a `/`.
    this.title.setTitle(TITULO_CATALOGO_PUBLICO);
    void this.librosService.cargarCatalogo();
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();

    const queryParams = this.route.snapshot.queryParamMap;
    const espacioInicial = queryParams.get('espacio');
    const muebleInicial = queryParams.get('mueble');
    if (espacioInicial) {
      this.espacioSeleccionado.set(espacioInicial);
    }
    if (muebleInicial) {
      this.muebleSeleccionado.set(muebleInicial);
    }
  }

  /** Al cambiar de Espacio, se limpia el Mueble elegido — puede no pertenecer al Espacio nuevo (mismo criterio de cascada que `/admin/ubicaciones`). */
  protected seleccionarEspacio(espacioId: string): void {
    this.espacioSeleccionado.set(espacioId);
    this.muebleSeleccionado.set('');
    this.actualizarQueryParams();
  }

  protected seleccionarMueble(muebleId: string): void {
    this.muebleSeleccionado.set(muebleId);
    this.actualizarQueryParams();
  }

  private actualizarQueryParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        espacio: this.espacioSeleccionado() || null,
        mueble: this.muebleSeleccionado() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
