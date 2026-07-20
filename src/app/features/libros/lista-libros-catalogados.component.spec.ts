import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import type { Libro } from '../../core/models/libro.model';
import { ListaLibrosCatalogadosComponent } from './lista-libros-catalogados.component';

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
  cantidadDisponible: 2,
  estanteId: 'estante-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
};

function configurarPrueba(opciones: { libros?: Libro[]; cargando?: boolean; error?: boolean } = {}) {
  const cargarCatalogoMock = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: LibrosService,
        useValue: {
          libros: signal(opciones.libros ?? [libroFalso]),
          cargando: signal(opciones.cargando ?? false),
          error: signal(opciones.error ?? false),
          cargarCatalogo: cargarCatalogoMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<ListaLibrosCatalogadosComponent> = TestBed.createComponent(
    ListaLibrosCatalogadosComponent,
  );
  fixture.detectChanges();

  return { fixture, cargarCatalogoMock };
}

describe('ListaLibrosCatalogadosComponent', () => {
  it('carga el catálogo al inicializar', () => {
    const { cargarCatalogoMock } = configurarPrueba();
    expect(cargarCatalogoMock).toHaveBeenCalledTimes(1);
  });

  it('muestra los libros catalogados con un enlace para cambiar el estante', () => {
    const { fixture } = configurarPrueba();

    expect(fixture.nativeElement.textContent).toContain('Cien años de soledad');
    const enlace = fixture.nativeElement.querySelector('a[href="/libros/book-1/estante"]');
    expect(enlace).not.toBeNull();
  });

  it('muestra un mensaje cuando no hay libros catalogados', () => {
    const { fixture } = configurarPrueba({ libros: [] });
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay libros catalogados.');
  });

  it('muestra un mensaje de error cuando falla la carga', () => {
    const { fixture } = configurarPrueba({ error: true });
    expect(fixture.nativeElement.textContent).toContain('No se pudo cargar el catálogo.');
  });
});
