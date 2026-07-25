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
    const libroEnOtraUbicacion: Libro = {
      ...libroFalso,
      bookId: 'book-2',
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

    it('filtra por Mueble', () => {
      const { fixture } = configurarPrueba({
        libros: [libroFalso, libroEnOtraUbicacion],
        cargando: false,
        error: false,
      });

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
});
