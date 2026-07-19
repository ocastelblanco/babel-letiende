import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LibrosService } from '../../core/api/libros.service';
import type { Libro } from '../../core/models/libro.model';
import { CatalogoPublicoComponent } from './catalogo-publico.component';

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

  it('muestra el título, autor y PVP formateado de cada libro', () => {
    const { fixture } = configurarPrueba({ libros: [libroFalso], cargando: false, error: false });

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Cien años de soledad');
    expect(texto).toContain('Gabriel García Márquez');
    expect(texto).toContain('$45.000');
  });
});
