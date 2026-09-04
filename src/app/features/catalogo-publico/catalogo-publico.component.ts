import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import type { Libro } from '../../core/models/libro.model';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';
import { SinPortadaFallbackDirective } from '../../shared/directivas/sin-portada-fallback.directive';
import { EscanerCodigoBarrasComponent } from '../../shared/escaner-codigo-barras/escaner-codigo-barras.component';

export type VistaCatalogo = 'tarjetas' | 'lista';
export type CriterioOrden = 'titulo' | 'autor' | 'pvp';
export type DireccionOrden = 'asc' | 'desc';

/**
 * Un grupo de libros del mismo ISBN, apilados en una sola tarjeta/fila del
 * listado (Tarea 4 del lote de duplicados, `docs/plan-duplicados-catalogacion.md`
 * §7, decisión **D2**: el apilamiento es SOLO por ISBN — un libro sin ISBN
 * siempre forma su propio grupo de 1). `bookId` es el del PRIMER libro del
 * grupo (en el orden en que aparece en `librosFiltrados`) — sirve solo para
 * el `routerLink` a la ficha; una vez ahí, `GET /api/libros/:bookId`
 * resuelve TODOS los ejemplares reales por ISBN, sin depender de cuál
 * `bookId` puntual haya elegido el listado.
 */
export interface LibroAgrupado {
  bookId: string;
  isbn: string | null;
  titulo: string;
  autor: string;
  portadaUrl: string | null;
  pvpMinimo: number;
  pvpMaximo: number;
  cantidadDisponibleTotal: number;
}

/** Agrupa un conjunto de libros que comparten ISBN en un único `LibroAgrupado` — PVP mínimo/máximo (D4) y `cantidadDisponible` sumada entre todos. */
function agruparLibros(libros: Libro[]): LibroAgrupado {
  const primero = libros[0] as Libro;
  const precios = libros.map((libro) => libro.pvp);
  return {
    bookId: primero.bookId,
    isbn: primero.isbn,
    titulo: primero.titulo,
    autor: primero.autor,
    portadaUrl: primero.portadaUrl,
    pvpMinimo: Math.min(...precios),
    pvpMaximo: Math.max(...precios),
    cantidadDisponibleTotal: libros.reduce((suma, libro) => suma + libro.cantidadDisponible, 0),
  };
}

/** Título de pestaña del catálogo público — mismo texto en todo momento (ver `ngOnInit`). */
export const TITULO_CATALOGO_PUBLICO = 'Catálogo librería - Le Tiende';

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
 *
 * Vista Tarjetas/Lista y orden (`ajustes-2026-07-27.md` Tarea 1): `vista`
 * alterna el layout sin recalcular nada; `librosOrdenados` aplica
 * `criterioOrden`/`direccionOrden` sobre `librosAgrupados` (3 criterios —
 * Título/Autor/PVP — con un botón aparte para invertir la dirección,
 * decisión confirmada con el usuario en vez de 6 opciones con dirección
 * explícita en el propio `<select>`). Ninguno de los dos persiste entre
 * visitas — no lo pidió el documento.
 *
 * Apilamiento por ISBN (Tarea 4 del lote de duplicados,
 * `docs/plan-duplicados-catalogacion.md` §7): `librosAgrupados` agrupa
 * `librosFiltrados` por ISBN antes de ordenar — libros catalogados por
 * separado que en realidad son el mismo título aparecen como una sola
 * tarjeta/fila, con el PVP mínimo/máximo (D4) y la `cantidadDisponible`
 * sumada entre todos los ejemplares. Un libro sin ISBN nunca se apila
 * (decisión **D2**). El `bookId` del grupo lleva a la ficha
 * (`LibroDetalleComponent`), que resuelve ahí los ejemplares reales.
 */
@Component({
  selector: 'app-catalogo-publico',
  imports: [PvpPipe, RouterLink, SinPortadaFallbackDirective, EscanerCodigoBarrasComponent],
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

  /** Vista Tarjetas/Lista (`ajustes-2026-07-27.md`) — por defecto Tarjetas, comportamiento sin cambios si el usuario no toca el toggle. */
  protected readonly vista = signal<VistaCatalogo>('tarjetas');

  /** Criterio y dirección de orden (`ajustes-2026-07-27.md`, decisión confirmada: 3 opciones + botón de dirección) — Título ascendente por defecto. */
  protected readonly criterioOrden = signal<CriterioOrden>('titulo');
  protected readonly direccionOrden = signal<DireccionOrden>('asc');

  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly espacioSeleccionado = signal('');
  protected readonly muebleSeleccionado = signal('');

  /**
   * Muebles del `<select>` dependiente: vacío si no hay Espacio elegido —
   * los nombres de Mueble no son únicos entre espacios distintos (ej.
   * "Biblioteca 1" puede existir en dos salas), así que sin un Espacio
   * elegido la lista sería ambigua. El `<select>` de Mueble se deshabilita
   * en la plantilla mientras esto esté vacío.
   */
  protected readonly mueblesFiltrados = computed(() => {
    const espacioId = this.espacioSeleccionado();
    if (espacioId === '') {
      return [];
    }
    return this.ubicacionFisicaService.muebles().filter((mueble) => mueble.espacioId === espacioId);
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

  /**
   * Agrupa `librosFiltrados` por ISBN (Tarea 4 del lote de duplicados,
   * `docs/plan-duplicados-catalogacion.md` §7) — todo en memoria, sin tocar
   * `GET /api/libros`: el catálogo completo ya está cargado. Un libro sin
   * ISBN nunca se apila (decisión **D2**), siempre queda como grupo de 1.
   */
  protected readonly librosAgrupados = computed(() => {
    const porIsbn = new Map<string, Libro[]>();
    const grupos: LibroAgrupado[] = [];

    for (const libro of this.librosFiltrados()) {
      if (libro.isbn === null) {
        grupos.push(agruparLibros([libro]));
        continue;
      }
      const existente = porIsbn.get(libro.isbn);
      if (existente) {
        existente.push(libro);
      } else {
        porIsbn.set(libro.isbn, [libro]);
      }
    }

    for (const librosDelGrupo of porIsbn.values()) {
      grupos.push(agruparLibros(librosDelGrupo));
    }

    return grupos;
  });

  /** Aplica `criterioOrden`/`direccionOrden` sobre los grupos ya armados — Título/Autor comparan con `normalizarTexto` (mismo criterio que la búsqueda), PVP compara por `pvpMinimo` (mismo criterio de rango que la ficha, D4). */
  protected readonly librosOrdenados = computed(() => {
    const criterio = this.criterioOrden();
    const factor = this.direccionOrden() === 'asc' ? 1 : -1;

    return [...this.librosAgrupados()].sort((a, b) => {
      if (criterio === 'pvp') {
        return (a.pvpMinimo - b.pvpMinimo) * factor;
      }
      const campoA = normalizarTexto(criterio === 'titulo' ? a.titulo : a.autor);
      const campoB = normalizarTexto(criterio === 'titulo' ? b.titulo : b.autor);
      return campoA.localeCompare(campoB) * factor;
    });
  });

  /** Visibilidad del modal de escaneo de ISBN — mismo patrón de overlay que `SelectorPortadaComponent`/el diálogo de "Vender" en `libro-detalle.component.ts`. */
  protected readonly escanerVisible = signal(false);
  /** Mensaje cuando el ISBN escaneado no tiene ningún libro coincidente en `libros()` — decisión de producto confirmada: nunca cae a la búsqueda de texto. */
  protected readonly errorEscaneoPublico = signal<string | null>(null);

  protected abrirEscaner(): void {
    this.errorEscaneoPublico.set(null);
    this.escanerVisible.set(true);
  }

  protected cerrarEscaner(): void {
    this.escanerVisible.set(false);
  }

  /**
   * Busca en `libros()` (ya cargado por `LibrosService`) el primer libro cuyo
   * `isbn` coincida exactamente con el código escaneado. Si hay match, cierra
   * el modal y navega directo a la ficha (`/libro/:bookId`) — sin pasar por
   * el filtro de texto. Si no hay match, muestra un mensaje de error dentro
   * del modal, que queda abierto para reintentar.
   */
  protected alDetectarCodigo(isbn: string): void {
    const libroEncontrado = this.libros().find((libro) => libro.isbn === isbn);
    if (libroEncontrado) {
      this.escanerVisible.set(false);
      void this.router.navigate(['/libro', libroEncontrado.bookId]);
      return;
    }
    this.errorEscaneoPublico.set('No se encontró ningún libro con ese código en el catálogo.');
  }

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

  protected seleccionarVista(vista: VistaCatalogo): void {
    this.vista.set(vista);
  }

  protected seleccionarCriterioOrden(criterio: string): void {
    this.criterioOrden.set(criterio as CriterioOrden);
  }

  protected alternarDireccionOrden(): void {
    this.direccionOrden.set(this.direccionOrden() === 'asc' ? 'desc' : 'asc');
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
