import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import type { Libro } from '../../core/models/libro.model';
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
  estanteId: 'estante-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-07-19T00:00:00.000Z',
  actualizadoEn: '2026-07-19T00:00:00.000Z',
};

function configurarPrueba(estado: { libros: Libro[]; cargando: boolean; error: boolean }) {
  const cargarCatalogoMock = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: LibrosService,
        useValue: {
          libros: signal(estado.libros),
          cargando: signal(estado.cargando),
          error: signal(estado.error),
          cargarCatalogo: cargarCatalogoMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<CatalogoPublicoComponent> = TestBed.createComponent(
    CatalogoPublicoComponent,
  );
  fixture.detectChanges();
  return { fixture, cargarCatalogoMock };
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
});
