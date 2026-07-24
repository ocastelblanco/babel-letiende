import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { LibrosService } from '../../core/api/libros.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import { VentaService } from '../../core/api/venta.service';
import type { LibroConUbicacion } from '../../core/models/libro.model';
import type { Usuario } from '../../core/models/usuario.model';
import { LibroDetalleComponent } from './libro-detalle.component';

const libroFalso: LibroConUbicacion = {
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
  ubicacionId: 'ubicacion-1',
  creadoPor: 'vendedor@letiende.co',
  creadoEn: '2026-07-19T00:00:00.000Z',
  actualizadoEn: '2026-07-19T00:00:00.000Z',
  ubicacion: { espacio: 'Sala principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 2' },
};

const usuarioFirebaseFalso = { uid: 'uid-1' } as unknown as import('firebase/auth').User;

const vendedorFalso: Usuario = {
  email: 'vendedor@letiende.co',
  nombre: 'Vendedor de prueba',
  fotoUrl: null,
  rol: 'vendedor',
  creadoEn: '2026-07-20T00:00:00.000Z',
};

function configurarPrueba(
  opciones: {
    bookId?: string;
    obtenerDetalleMock?: ReturnType<typeof vi.fn>;
    usuario?: import('firebase/auth').User | null;
    usuarioActual?: Usuario | null;
    registrarVentaMock?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const obtenerDetalleMock = opciones.obtenerDetalleMock ?? vi.fn().mockResolvedValue(libroFalso);
  const registrarVentaMock =
    opciones.registrarVentaMock ?? vi.fn().mockResolvedValue({ exito: true, venta: {} });
  const obtenerUsuarioActualMock = vi.fn().mockResolvedValue(opciones.usuarioActual ?? null);

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ bookId: opciones.bookId ?? 'book-1' }) } },
      },
      { provide: LibrosService, useValue: { obtenerDetalle: obtenerDetalleMock } },
      {
        provide: AuthService,
        useValue: { usuario: signal(opciones.usuario ?? null) },
      },
      {
        provide: UsuariosService,
        useValue: {
          usuarioActual: signal(opciones.usuarioActual ?? null),
          obtenerUsuarioActual: obtenerUsuarioActualMock,
        },
      },
      { provide: VentaService, useValue: { registrarVenta: registrarVentaMock } },
    ],
  });

  const fixture: ComponentFixture<LibroDetalleComponent> = TestBed.createComponent(LibroDetalleComponent);
  fixture.detectChanges();

  return { fixture, obtenerDetalleMock, registrarVentaMock, obtenerUsuarioActualMock };
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

  it('no muestra la sección de ubicación cuando la ubicación es null', async () => {
    const obtenerDetalleMock = vi.fn().mockResolvedValue({ ...libroFalso, ubicacion: null });
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

  describe('botón Vender', () => {
    it('no aparece sin sesión activa', async () => {
      const { fixture } = configurarPrueba();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Vender');
    });

    it('no aparece con sesión pero sin rol vendedor/administrador', async () => {
      const { fixture } = configurarPrueba({ usuario: usuarioFirebaseFalso, usuarioActual: null });
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Vender');
    });

    it('no aparece si no quedan ejemplares disponibles, aunque el rol sea válido', async () => {
      const obtenerDetalleMock = vi.fn().mockResolvedValue({ ...libroFalso, cantidadDisponible: 0 });
      const { fixture } = configurarPrueba({
        obtenerDetalleMock,
        usuario: usuarioFirebaseFalso,
        usuarioActual: vendedorFalso,
      });
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Vender');
    });

    it('aparece con sesión activa y rol vendedor, con ejemplares disponibles', async () => {
      const { fixture } = configurarPrueba({ usuario: usuarioFirebaseFalso, usuarioActual: vendedorFalso });
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Vender');
    });
  });

  describe('diálogo de venta', () => {
    function abrirFicha(opciones: Parameters<typeof configurarPrueba>[0] = {}) {
      return configurarPrueba({ usuario: usuarioFirebaseFalso, usuarioActual: vendedorFalso, ...opciones });
    }

    async function abrirDialogo(fixture: ComponentFixture<LibroDetalleComponent>) {
      await Promise.resolve();
      fixture.detectChanges();
      const botones = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ) as HTMLButtonElement[];
      const boton = botones.find((b) => b.textContent?.trim() === 'Vender') as HTMLButtonElement;
      boton.click();
      fixture.detectChanges();
    }

    it('se abre al hacer clic en Vender y se cierra con Cancelar', async () => {
      const { fixture } = abrirFicha();
      await abrirDialogo(fixture);

      expect(fixture.nativeElement.textContent).toContain('Confirmar');

      const botonesCancelar = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ) as HTMLButtonElement[];
      const botonCancelar = botonesCancelar.find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement;
      botonCancelar.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('Confirmar');
    });

    it('confirma la venta, muestra el mensaje de éxito y refresca la disponibilidad', async () => {
      const obtenerDetalleMock = vi
        .fn()
        .mockResolvedValueOnce(libroFalso)
        .mockResolvedValueOnce({ ...libroFalso, cantidadDisponible: 0 });
      const registrarVentaMock = vi.fn().mockResolvedValue({ exito: true, venta: {} });
      const { fixture } = abrirFicha({ obtenerDetalleMock, registrarVentaMock });
      await abrirDialogo(fixture);

      const componente = fixture.componentInstance;
      componente['formularioVenta'].setValue({ cantidad: 1, porcentajeDescuentoVenta: 0, formaDePago: 'efectivo' });
      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(registrarVentaMock).toHaveBeenCalledWith({
        bookId: 'book-1',
        cantidad: 1,
        porcentajeDescuentoVenta: 0,
        formaDePago: 'efectivo',
      });
      expect(fixture.nativeElement.textContent).toContain('Venta registrada correctamente.');
      expect(fixture.nativeElement.textContent).not.toContain('Vender');
      expect(obtenerDetalleMock).toHaveBeenCalledTimes(2);
    });

    it('muestra el mensaje de error del backend sin cerrar el diálogo si la venta falla', async () => {
      const registrarVentaMock = vi
        .fn()
        .mockResolvedValue({ exito: false, error: 'No quedan suficientes ejemplares disponibles de este libro.' });
      const { fixture } = abrirFicha({ registrarVentaMock });
      await abrirDialogo(fixture);

      const componente = fixture.componentInstance;
      componente['formularioVenta'].setValue({ cantidad: 1, porcentajeDescuentoVenta: 0, formaDePago: 'efectivo' });
      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit'));
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No quedan suficientes ejemplares');
      expect(fixture.nativeElement.textContent).toContain('Confirmar');
    });
  });
});
