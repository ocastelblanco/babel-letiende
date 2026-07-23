import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import type { LibroConEstante } from '../../core/models/libro.model';
import { LibroDetalleComponent } from './libro-detalle.component';

const libroFalso: LibroConEstante = {
  isbn: '9780000000000',
  bookId: 'book-1',
  titulo: 'Cien años de soledad',
  autor: 'Gabriel García Márquez',
  editorial: 'Sudamericana',
  portadaUrl: 'https://books.google.com/portada.jpg',
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
  estante: { espacio: 'Sala principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 2' },
};

function configurarPrueba(opciones: { bookId?: string; obtenerDetalleMock?: ReturnType<typeof vi.fn> } = {}) {
  const obtenerDetalleMock = opciones.obtenerDetalleMock ?? vi.fn().mockResolvedValue(libroFalso);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ bookId: opciones.bookId ?? 'book-1' }) } },
      },
      { provide: LibrosService, useValue: { obtenerDetalle: obtenerDetalleMock } },
    ],
  });

  const fixture: ComponentFixture<LibroDetalleComponent> = TestBed.createComponent(LibroDetalleComponent);
  fixture.detectChanges();

  return { fixture, obtenerDetalleMock };
}

describe('LibroDetalleComponent', () => {
  it('pide el detalle con el bookId de la ruta', async () => {
    const { fixture, obtenerDetalleMock } = configurarPrueba({ bookId: 'book-1' });
    await Promise.resolve();
    fixture.detectChanges();

    expect(obtenerDetalleMock).toHaveBeenCalledWith('book-1');
  });

  it('muestra el mensaje de carga mientras se resuelve el libro', () => {
    const obtenerDetalleMock = vi.fn(() => new Promise<never>(() => {}));
    const { fixture } = configurarPrueba({ obtenerDetalleMock });

    expect(fixture.nativeElement.textContent).toContain('Cargando');
  });

  it('muestra título, autor, editorial, PVP y ubicación física cuando el libro se encuentra', async () => {
    const { fixture } = configurarPrueba();
    await Promise.resolve();
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Cien años de soledad');
    expect(texto).toContain('Gabriel García Márquez');
    expect(texto).toContain('Sudamericana');
    expect(texto).toContain('$45.000');
    expect(texto).toContain('Sala principal');
    expect(texto).toContain('Biblioteca 1');
    expect(texto).toContain('Estante 2');
  });

  it('no muestra la sección de ubicación cuando el estante es null', async () => {
    const obtenerDetalleMock = vi.fn().mockResolvedValue({ ...libroFalso, estante: null });
    const { fixture } = configurarPrueba({ obtenerDetalleMock });
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Ubicación en la librería');
  });

  it('muestra un mensaje manejado (no un error crudo) cuando el libro no existe', async () => {
    const obtenerDetalleMock = vi.fn().mockResolvedValue(null);
    const { fixture } = configurarPrueba({ obtenerDetalleMock });
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No se encontró este libro');
  });

  it('actualiza el título de la página con el título del libro encontrado', async () => {
    const { fixture } = configurarPrueba();
    await Promise.resolve();
    fixture.detectChanges();

    expect(TestBed.inject(Title).getTitle()).toContain('Cien años de soledad');
  });
});
