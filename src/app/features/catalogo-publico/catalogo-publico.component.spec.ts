import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import type { Espacio } from '../../core/models/espacio.model';
import type { Libro } from '../../core/models/libro.model';
import type { Mueble } from '../../core/models/mueble.model';
import type { Ubicacion } from '../../core/models/ubicacion.model';
import { CatalogoPublicoComponent, TITULO_CATALOGO_PUBLICO } from './catalogo-publico.component';

const libroFalso: Libro = {
  isbn: '9780000000000',
  bookId: 'book-1',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  costo: 29250,
  utilidadCatalogo: 15750,
  cantidadTotal: 2,
  cantidadDisponible: 1,
  ubicacionId: 'ubicacion-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-07-19T00:00:00.000Z',
  actualizadoEn: '2026-07-19T00:00:00.000Z',
};

const espacioPrincipal: Espacio = { espacioId: 'espacio-1', nombre: 'Sala principal' };
const espacioVip: Espacio = { espacioId: 'espacio-2', nombre: 'Sala VIP' };
const muebleBiblioteca1: Mueble = { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1' };
const muebleBiblioteca2: Mueble = { muebleId: 'mueble-2', espacioId: 'espacio-2', nombre: 'Biblioteca 2' };
const ubicacion1: Ubicacion = { ubicacionId: 'ubicacion-1', muebleId: 'mueble-1', nombre: 'Estante 1' };
const ubicacion2: Ubicacion = { ubicacionId: 'ubicacion-2', muebleId: 'mueble-2', nombre: 'Estante 2' };

function configurarPrueba(
  estado: { libros: Libro[]; cargando: boolean; error: boolean },
  opciones: {
    espacios?: Espacio[];
    muebles?: Mueble[];
    ubicaciones?: Ubicacion[];
    queryParams?: Record<string, string>;
  } = {},
) {
  const cargarCatalogoMock = vi.fn().mockResolvedValue(undefined);
  const navigateMock = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Router, useValue: { navigate: navigateMock } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(opciones.queryParams ?? {}) } },
      },
      {
        provide: LibrosService,
        useValue: {
          libros: signal(estado.libros),
          cargando: signal(estado.cargando),
          error: signal(estado.error),
          cargarCatalogo: cargarCatalogoMock,
        },
      },
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal(opciones.espacios ?? [espacioPrincipal, espacioVip]),
          muebles: signal(opciones.muebles ?? [muebleBiblioteca1, muebleBiblioteca2]),
          ubicaciones: signal(opciones.ubicaciones ?? [ubicacion1, ubicacion2]),
          errorEspacios: signal(false),
          errorMuebles: signal(false),
          errorUbicaciones: signal(false),
          cargarEspacios: vi.fn().mockResolvedValue(undefined),
          cargarMuebles: vi.fn().mockResolvedValue(undefined),
          cargarUbicaciones: vi.fn().mockResolvedValue(undefined),
        },
      },
    ],
  });

  const fixture: ComponentFixture<CatalogoPublicoComponent> = TestBed.createComponent(
    CatalogoPublicoComponent,
  );
  fixture.detectChanges();
  return { fixture, cargarCatalogoMock, navigateMock };
}

describe('CatalogoPublicoComponent', () => {
  it('llama a cargarCatalogo() al inicializar', () => {
    const { cargarCatalogoMock } = configurarPrueba({ libros: [], cargando: true, error: false });

    expect(cargarCatalogoMock).toHaveBeenCalledTimes(1);
  });

  it('muestra el mensaje de carga mientras cargando() es true', () => {
    const { fixture } = configurarPrueba({ libros: [], cargando: true, error: false });

    expect(fixture.nativeElement.textContent).toContain('Cargando catálogo');
  });

  it('muestra el mensaje de error cuando error() es true', () => {
    const { fixture } = configurarPrueba({ libros: [], cargando: false, error: true });

    expect(fixture.nativeElement.textContent).toContain('No se pudo cargar el catálogo');
  });

  it('muestra el mensaje de catálogo vacío cuando no hay libros', () => {
    const { fixture } = configurarPrueba({ libros: [], cargando: false, error: false });

    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros disponibles');
  });

  it('muestra "Catálogo Librería" como encabezado tras el logo', () => {
    const { fixture } = configurarPrueba({ libros: [], cargando: false, error: false });

    const encabezado = fixture.nativeElement.querySelector('h1') as HTMLElement;
    expect(encabezado.textContent).toContain('Catálogo Librería');
  });

  it('siempre resetea el título de la pestaña, aunque haya quedado sobrescrito por una ficha de libro visitada antes', () => {
    // Simula el escenario real del bug: el título quedó "pegado" al de un
    // libro visitado antes de entrar/volver a `/` (`Title` es singleton).
    document.title = 'Cuentos de amor — Catálogo Le Tiende';

    configurarPrueba({ libros: [], cargando: false, error: false });

    expect(TestBed.inject(Title).getTitle()).toBe(TITULO_CATALOGO_PUBLICO);
  });

  it('muestra el título, autor y PVP formateado de cada libro', () => {
    const { fixture } = configurarPrueba({ libros: [libroFalso], cargando: false, error: false });

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Cien años de soledad');
    expect(texto).toContain('Gabriel García Márquez');
    expect(texto).toContain('$45.000');
  });

  describe('búsqueda por título/autor/ISBN', () => {
    const otroLibro: Libro = {
      ...libroFalso,
      bookId: 'book-2',
      isbn: '9781234567897',
      titulo: 'Aniquilación',
      autor: 'Michel Houellebecq',
    };

    function campoBusqueda(fixture: ComponentFixture<CatalogoPublicoComponent>): HTMLInputElement {
      return fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    }

    function escribirBusqueda(fixture: ComponentFixture<CatalogoPublicoComponent>, texto: string): void {
      const campo = campoBusqueda(fixture);
      campo.value = texto;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('no muestra el campo de búsqueda mientras carga', () => {
      const { fixture } = configurarPrueba({ libros: [], cargando: true, error: false });
      expect(campoBusqueda(fixture)).toBeFalsy();
    });

    it('no muestra el campo de búsqueda en error', () => {
      const { fixture } = configurarPrueba({ libros: [], cargando: false, error: true });
      expect(campoBusqueda(fixture)).toBeFalsy();
    });

    it('no muestra el campo de búsqueda con el catálogo vacío', () => {
      const { fixture } = configurarPrueba({ libros: [], cargando: false, error: false });
      expect(campoBusqueda(fixture)).toBeFalsy();
    });

    it('sin término de búsqueda, muestra todo el catálogo', () => {
      const { fixture } = configurarPrueba({ libros: [libroFalso, otroLibro], cargando: false, error: false });

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Cien años de soledad');
      expect(texto).toContain('Aniquilación');
    });

    it('filtra por título, sin distinguir mayúsculas ni tildes', () => {
      const { fixture } = configurarPrueba({ libros: [libroFalso, otroLibro], cargando: false, error: false });

      escribirBusqueda(fixture, 'aniquilacion');

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Aniquilación');
      expect(texto).not.toContain('Cien años de soledad');
    });

    it('filtra por autor', () => {
      const { fixture } = configurarPrueba({ libros: [libroFalso, otroLibro], cargando: false, error: false });

      escribirBusqueda(fixture, 'houellebecq');

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Aniquilación');
      expect(texto).not.toContain('Cien años de soledad');
    });

    it('filtra por ISBN', () => {
      const { fixture } = configurarPrueba({ libros: [libroFalso, otroLibro], cargando: false, error: false });

      escribirBusqueda(fixture, '9781234567897');

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Aniquilación');
      expect(texto).not.toContain('Cien años de soledad');
    });

    it('muestra un mensaje neutral cuando la búsqueda no encuentra ningún libro', () => {
      const { fixture } = configurarPrueba({ libros: [libroFalso, otroLibro], cargando: false, error: false });

      escribirBusqueda(fixture, 'libro que no existe');

      expect(fixture.nativeElement.textContent).toContain('No se encontraron libros para tu búsqueda');
    });

    it('vaciar el término de búsqueda vuelve a mostrar todo el catálogo', () => {
      const { fixture } = configurarPrueba({ libros: [libroFalso, otroLibro], cargando: false, error: false });

      escribirBusqueda(fixture, 'aniquilacion');
      escribirBusqueda(fixture, '');

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Cien años de soledad');
      expect(texto).toContain('Aniquilación');
    });
  });

  describe('filtro por ubicación (Espacio/Mueble)', () => {
    // `libroFalso` está en ubicacion-1 (mueble-1, espacio-1); este segundo libro está en ubicacion-2 (mueble-2, espacio-2).
    // `isbn: null` (en vez de heredar el de `libroFalso`) — son dos libros DISTINTOS sin relación entre sí, no deben
    // apilarse en un solo grupo (Tarea 4, `docs/plan-duplicados-catalogacion.md` §7, decisión D2).
    const libroEnOtraUbicacion: Libro = {
      ...libroFalso,
      bookId: 'book-2',
      isbn: null,
      titulo: 'Aniquilación',
      autor: 'Michel Houellebecq',
      ubicacionId: 'ubicacion-2',
    };

    function selectEspacio(fixture: ComponentFixture<CatalogoPublicoComponent>): HTMLSelectElement {
      return fixture.nativeElement.querySelectorAll('select')[0] as HTMLSelectElement;
    }

    function selectMueble(fixture: ComponentFixture<CatalogoPublicoComponent>): HTMLSelectElement {
      return fixture.nativeElement.querySelectorAll('select')[1] as HTMLSelectElement;
    }

    function elegir(select: HTMLSelectElement, valor: string): void {
      select.value = valor;
      select.dispatchEvent(new Event('change'));
    }

    function escribirBusqueda(fixture: ComponentFixture<CatalogoPublicoComponent>, texto: string): void {
      const campo = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
      campo.value = texto;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('sin filtro de ubicación, muestra todo el catálogo', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Cien años de soledad');
      expect(texto).toContain('Aniquilación');
    });

    it('filtra por Espacio (resuelve ubicacionId → muebleId → espacioId)', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      elegir(selectEspacio(fixture), 'espacio-2');
      fixture.detectChanges();

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Aniquilación');
      expect(texto).not.toContain('Cien años de soledad');
    });

    it('filtra por Mueble (requiere elegir primero el Espacio que lo contiene, para habilitar el select)', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      elegir(selectEspacio(fixture), 'espacio-2');
      fixture.detectChanges();
      elegir(selectMueble(fixture), 'mueble-2');
      fixture.detectChanges();

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Aniquilación');
      expect(texto).not.toContain('Cien años de soledad');
    });

    it('el filtro de ubicación es acumulativo con la búsqueda de texto', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      elegir(selectEspacio(fixture), 'espacio-1');
      escribirBusqueda(fixture, 'aniquilacion');

      expect(fixture.nativeElement.textContent).toContain('No se encontraron libros para tu búsqueda');
    });

    it('el select de Mueble se limita al Espacio elegido, y cambiar de Espacio limpia el Mueble', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      elegir(selectEspacio(fixture), 'espacio-1');
      fixture.detectChanges();
      let opciones = selectMueble(fixture).querySelectorAll('option');
      expect(Array.from(opciones).map((o) => o.textContent?.trim())).toEqual(['Todos los muebles', 'Biblioteca 1']);

      elegir(selectMueble(fixture), 'mueble-1');
      fixture.detectChanges();
      elegir(selectEspacio(fixture), 'espacio-2');
      fixture.detectChanges();

      expect(selectMueble(fixture).value).toBe('');
      opciones = selectMueble(fixture).querySelectorAll('option');
      expect(Array.from(opciones).map((o) => o.textContent?.trim())).toEqual(['Todos los muebles', 'Biblioteca 2']);
    });

    it('sin Espacio elegido, el select de Mueble no muestra ningún mueble (nombres no son únicos entre espacios) y queda deshabilitado', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      const opciones = selectMueble(fixture).querySelectorAll('option');
      expect(Array.from(opciones).map((o) => o.textContent?.trim())).toEqual(['Todos los muebles']);
      expect(selectMueble(fixture).disabled).toBe(true);
    });

    it('al elegir un Espacio, el select de Mueble se habilita y muestra solo los muebles de ese Espacio', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      elegir(selectEspacio(fixture), 'espacio-1');
      fixture.detectChanges();

      expect(selectMueble(fixture).disabled).toBe(false);
      const opciones = selectMueble(fixture).querySelectorAll('option');
      expect(Array.from(opciones).map((o) => o.textContent?.trim())).toEqual(['Todos los muebles', 'Biblioteca 1']);
    });

    it('preselecciona los selects desde los query params ?espacio=&mueble= al entrar', () => {
      const { fixture } = configurarPrueba(
        { libros: [libroFalso, libroEnOtraUbicacion], cargando: false, error: false },
        { queryParams: { espacio: 'espacio-2', mueble: 'mueble-2' } },
      );

      expect(selectEspacio(fixture).value).toBe('espacio-2');
      expect(selectMueble(fixture).value).toBe('mueble-2');
      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Aniquilación');
      expect(texto).not.toContain('Cien años de soledad');
    });

    it('cambiar el Espacio actualiza los query params de la URL', () => {
      const { fixture, navigateMock } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

      elegir(selectEspacio(fixture), 'espacio-2');

      expect(navigateMock).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { espacio: 'espacio-2', mueble: null } }),
      );
    });
  });

  describe('vista Tarjetas/Lista y orden (ajustes-2026-07-27.md)', () => {
    // `isbn: null` en los 3 — son libros DISTINTOS sin relación entre sí, no deben apilarse en un solo grupo
    // (Tarea 4, `docs/plan-duplicados-catalogacion.md` §7, decisión D2) solo por heredar el isbn de `libroFalso`.
    const libroAlfa: Libro = {
      ...libroFalso,
      bookId: 'book-alfa',
      isbn: null,
      titulo: 'Alfa',
      autor: 'Alfa',
      pvp: 10000,
    };
    const libroBeta: Libro = {
      ...libroFalso,
      bookId: 'book-beta',
      isbn: null,
      titulo: 'Beta',
      autor: 'Bravo',
      pvp: 30000,
    };
    const libroCharlie: Libro = {
      ...libroFalso,
      bookId: 'book-charlie',
      isbn: null,
      titulo: 'Charlie',
      autor: 'Charlie',
      pvp: 20000,
    };
    const libros = [libroBeta, libroAlfa, libroCharlie];

    function botonPorTexto(fixture: ComponentFixture<CatalogoPublicoComponent>, texto: string): HTMLButtonElement {
      const botones = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
      return botones.find((boton) => boton.textContent?.trim() === texto) as HTMLButtonElement;
    }

    function selectOrden(fixture: ComponentFixture<CatalogoPublicoComponent>): HTMLSelectElement {
      return fixture.nativeElement.querySelectorAll('select')[2] as HTMLSelectElement;
    }

    function botonDireccion(fixture: ComponentFixture<CatalogoPublicoComponent>): HTMLButtonElement {
      return fixture.nativeElement.querySelector('[aria-label]') as HTMLButtonElement;
    }

    function titulosEnOrden(fixture: ComponentFixture<CatalogoPublicoComponent>): string[] {
      const items = Array.from(fixture.nativeElement.querySelectorAll('li')) as HTMLLIElement[];
      return items.map((li) => (li.querySelector('p') as HTMLElement).textContent?.trim() ?? '');
    }

    it('muestra la vista de Tarjetas (grid) por defecto', () => {
      const { fixture } = configurarPrueba({ libros, cargando: false, error: false });

      const lista = fixture.nativeElement.querySelector('ul') as HTMLUListElement;
      expect(lista.className).toContain('grid');
    });

    it('el botón "Lista" cambia a la vista de lista (sin grid)', () => {
      const { fixture } = configurarPrueba({ libros, cargando: false, error: false });

      botonPorTexto(fixture, 'Lista').click();
      fixture.detectChanges();

      const lista = fixture.nativeElement.querySelector('ul') as HTMLUListElement;
      expect(lista.className).not.toContain('grid');
      expect(fixture.nativeElement.textContent).toContain('Alfa');
    });

    it('ordena por Título ascendente por defecto', () => {
      const { fixture } = configurarPrueba({ libros, cargando: false, error: false });

      expect(titulosEnOrden(fixture)).toEqual(['Alfa', 'Beta', 'Charlie']);
    });

    it('ordena por Precio al elegir esa opción en el desplegable', () => {
      const { fixture } = configurarPrueba({ libros, cargando: false, error: false });

      const select = selectOrden(fixture);
      select.value = 'pvp';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(titulosEnOrden(fixture)).toEqual(['Alfa', 'Charlie', 'Beta']);
    });

    it('el botón de dirección invierte el orden (descendente)', () => {
      const { fixture } = configurarPrueba({ libros, cargando: false, error: false });

      botonDireccion(fixture).click();
      fixture.detectChanges();

      expect(titulosEnOrden(fixture)).toEqual(['Charlie', 'Beta', 'Alfa']);
    });
  });

  describe('apilamiento por ISBN (Tarea 4 del lote de duplicados, docs/plan-duplicados-catalogacion.md §7)', () => {
    it('dos libros catalogados por separado con el mismo ISBN aparecen como UNA sola tarjeta, con la cantidad sumada', () => {
      const segundoEjemplar: Libro = {
        ...libroFalso,
        bookId: 'book-2',
        ubicacionId: 'ubicacion-2',
        cantidadDisponible: 2,
      };
      const { fixture } = configurarPrueba({
        libros: [libroFalso, segundoEjemplar],
        cargando: false,
        error: false,
      });

      const tarjetas = fixture.nativeElement.querySelectorAll('li');
      expect(tarjetas.length).toBe(1);
      expect(fixture.nativeElement.textContent).toContain('Cien años de soledad');
    });

    it('el grupo lleva el bookId del primer ejemplar (la ficha resuelve el resto por ISBN)', () => {
      const segundoEjemplar: Libro = { ...libroFalso, bookId: 'book-2', ubicacionId: 'ubicacion-2' };
      const { fixture } = configurarPrueba({
        libros: [libroFalso, segundoEjemplar],
        cargando: false,
        error: false,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.librosAgrupados()).toHaveLength(1);
      expect(componente.librosAgrupados()[0].bookId).toBe('book-1');
    });

    it('muestra el PVP como rango cuando los ejemplares agrupados tienen precios distintos (D4)', () => {
      const segundoEjemplar: Libro = {
        ...libroFalso,
        bookId: 'book-2',
        ubicacionId: 'ubicacion-2',
        pvp: 52000,
      };
      const { fixture } = configurarPrueba({
        libros: [libroFalso, segundoEjemplar],
        cargando: false,
        error: false,
      });

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('$45.000 – $52.000');
    });

    it('muestra un único PVP cuando todos los ejemplares agrupados cuestan lo mismo', () => {
      const segundoEjemplar: Libro = { ...libroFalso, bookId: 'book-2', ubicacionId: 'ubicacion-2' };
      const { fixture } = configurarPrueba({
        libros: [libroFalso, segundoEjemplar],
        cargando: false,
        error: false,
      });

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('$45.000');
      expect(texto).not.toContain('–');
    });

    it('un libro sin ISBN nunca se apila, aunque comparta todo lo demás con otro libro también sin ISBN', () => {
      const libroSinIsbnA: Libro = { ...libroFalso, bookId: 'book-a', isbn: null };
      const libroSinIsbnB: Libro = { ...libroFalso, bookId: 'book-b', isbn: null };
      const { fixture } = configurarPrueba({
        libros: [libroSinIsbnA, libroSinIsbnB],
        cargando: false,
        error: false,
      });

      // Dos tarjetas independientes, no una sola agrupada.
      expect(fixture.nativeElement.querySelectorAll('li').length).toBe(2);
    });
  });
});
