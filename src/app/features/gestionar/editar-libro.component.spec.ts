import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { LibrosService } from '../../core/api/libros.service';
import { MetadatosService } from '../../core/api/metadatos.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import type { Espacio } from '../../core/models/espacio.model';
import type { Libro } from '../../core/models/libro.model';
import type { Mueble } from '../../core/models/mueble.model';
import type { Ubicacion } from '../../core/models/ubicacion.model';
import type { Usuario } from '../../core/models/usuario.model';
import { EditarLibroComponent } from './editar-libro.component';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo mock que en el resto de specs.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

// Sin cámara real en CI/sandbox — mismo mock mínimo que en `catalogar-libro.component.spec.ts`.
const detenerEscaneoMock = vi.fn();
let callbackDecodificacion: ((resultado: { getText: () => string } | undefined) => void) | undefined;
const decodeFromConstraintsMock = vi.fn(
  (_constraints: unknown, _video: unknown, callback: (resultado: { getText: () => string } | undefined) => void) => {
    callbackDecodificacion = callback;
    return Promise.resolve({ stop: detenerEscaneoMock });
  },
);
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: vi.fn(function BrowserMultiFormatReaderFalso() {
    return { decodeFromConstraints: decodeFromConstraintsMock };
  }),
}));

const espacioFalso: Espacio = { espacioId: 'espacio-1', nombre: 'Sala principal' };
const muebleFalso: Mueble = { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1' };
const ubicacionFalsa: Ubicacion = { ubicacionId: 'ubicacion-1', muebleId: 'mueble-1', nombre: 'Estante 1' };

const libroFalso: Libro = {
  isbn: '9780000000000',
  bookId: 'libro-1',
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
  creadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
};

const libroAgotado: Libro = { ...libroFalso, bookId: 'libro-2', titulo: 'Otro libro', autor: 'Otro autor', isbn: null, cantidadDisponible: 0 };

const libroConPortada: Libro = {
  ...libroFalso,
  bookId: 'libro-3',
  titulo: 'Libro con portada',
  portadaUrl: 'https://ejemplo.com/portada-vieja.jpg',
};

const vendedorFalso: Usuario = {
  email: 'vendedor@letiende.co',
  nombre: 'Vendedor',
  fotoUrl: null,
  rol: 'vendedor',
  creadoEn: '2026-01-01T00:00:00.000Z',
};
const administradorFalso: Usuario = { ...vendedorFalso, email: 'admin@letiende.co', rol: 'administrador' };

function configurarPrueba(
  opciones: { rol?: Usuario | null; libros?: Libro[] } = {},
) {
  const cargarInventarioMock = vi.fn().mockResolvedValue(undefined);
  const cargarEspaciosMock = vi.fn().mockResolvedValue(undefined);
  const cargarMueblesMock = vi.fn().mockResolvedValue(undefined);
  const cargarUbicacionesMock = vi.fn().mockResolvedValue(undefined);
  const editarLibroMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarLibroMock = vi.fn().mockResolvedValue({ exito: true });
  const buscarPortadasMock = vi.fn().mockResolvedValue([]);
  const usuario = opciones.rol ?? null;

  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { usuario: signal(usuario ? { email: usuario.email } : null) } },
      { provide: UsuariosService, useValue: { usuarioActual: signal(usuario) } },
      { provide: MetadatosService, useValue: { buscarPortadas: buscarPortadasMock } },
      {
        provide: LibrosService,
        useValue: {
          inventario: signal(opciones.libros ?? [libroFalso, libroAgotado]),
          cargandoInventario: signal(false),
          errorInventario: signal(false),
          cargarInventario: cargarInventarioMock,
          editarLibro: editarLibroMock,
          eliminarLibro: eliminarLibroMock,
        },
      },
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal([espacioFalso]),
          muebles: signal([muebleFalso]),
          ubicaciones: signal([ubicacionFalsa]),
          cargarEspacios: cargarEspaciosMock,
          cargarMuebles: cargarMueblesMock,
          cargarUbicaciones: cargarUbicacionesMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<EditarLibroComponent> = TestBed.createComponent(EditarLibroComponent);
  fixture.detectChanges();

  return {
    fixture,
    cargarInventarioMock,
    cargarEspaciosMock,
    cargarMueblesMock,
    cargarUbicacionesMock,
    editarLibroMock,
    eliminarLibroMock,
    buscarPortadasMock,
  };
}

function botonPorTexto(fixture: ComponentFixture<EditarLibroComponent>, texto: string): HTMLButtonElement | undefined {
  return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
    (boton) => boton.textContent?.trim() === texto,
  );
}

describe('EditarLibroComponent', () => {
  beforeEach(() => {
    callbackDecodificacion = undefined;
    decodeFromConstraintsMock.mockClear();
    detenerEscaneoMock.mockClear();
  });

  it('carga el inventario y la ubicación física al inicializar', () => {
    const { cargarInventarioMock, cargarEspaciosMock, cargarMueblesMock, cargarUbicacionesMock } = configurarPrueba();

    expect(cargarInventarioMock).toHaveBeenCalledTimes(1);
    expect(cargarEspaciosMock).toHaveBeenCalledTimes(1);
    expect(cargarMueblesMock).toHaveBeenCalledTimes(1);
    expect(cargarUbicacionesMock).toHaveBeenCalledTimes(1);
  });

  it('lista todos los libros del inventario, incluidos los agotados', () => {
    const { fixture } = configurarPrueba();

    expect(fixture.nativeElement.textContent).toContain('Cien años de soledad');
    expect(fixture.nativeElement.textContent).toContain('Otro libro');
  });

  describe('filtro por título/autor/ISBN', () => {
    it('filtra por título (insensible a mayúsculas/tildes)', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.filtro.set('cien anos');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Cien años de soledad');
      expect(fixture.nativeElement.textContent).not.toContain('Otro libro');
    });

    it('filtra por autor', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.filtro.set('Otro autor');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Otro libro');
      expect(fixture.nativeElement.textContent).not.toContain('Cien años de soledad');
    });

    it('filtra por ISBN', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.filtro.set('9780000000000');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Cien años de soledad');
      expect(fixture.nativeElement.textContent).not.toContain('Otro libro');
    });

    it('muestra un mensaje cuando el filtro no encuentra resultados', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.filtro.set('no existe ningún libro así');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No se encontraron libros.');
    });

    it('el botón "Escanear ISBN" completa el filtro con el resultado del scanner', async () => {
      const { fixture } = configurarPrueba();

      botonPorTexto(fixture, 'Escanear ISBN')?.click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);
      callbackDecodificacion?.({ getText: () => '9780000000000' });
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.filtro()).toBe('9780000000000');
      expect(componente.escaneando()).toBe(false);
      expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('guard visual "ELIMINAR LIBRO" (ADR-009)', () => {
    it('no muestra el botón para un vendedor', () => {
      const { fixture } = configurarPrueba({ rol: vendedorFalso });

      expect(botonPorTexto(fixture, 'Eliminar libro')).toBeFalsy();
    });

    it('muestra el botón para un administrador', () => {
      const { fixture } = configurarPrueba({ rol: administradorFalso });

      expect(botonPorTexto(fixture, 'Eliminar libro')).toBeTruthy();
    });

    it('no muestra el botón sin sesión', () => {
      const { fixture } = configurarPrueba({ rol: null });

      expect(botonPorTexto(fixture, 'Eliminar libro')).toBeFalsy();
    });
  });

  describe('editar un libro', () => {
    it('abre el formulario precargado, resolviendo la cascada Espacio/Mueble desde la ubicación actual', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.editar(libroFalso);
      fixture.detectChanges();

      expect(componente.libroEditandoId()).toBe('libro-1');
      expect(componente.editEspacioId()).toBe('espacio-1');
      expect(componente.editMuebleId()).toBe('mueble-1');
      expect(componente.editUbicacionId()).toBe('ubicacion-1');
      expect(componente.formularioEdicion.value.isbn).toBe('9780000000000');
      expect(componente.formularioEdicion.value.titulo).toBe('Cien años de soledad');
      expect(componente.formularioEdicion.value.autor).toBe('Gabriel García Márquez');
      expect(componente.formularioEdicion.value.editorial).toBe('Sudamericana');
      expect(componente.formularioEdicion.value.portadaUrl).toBe('');
      expect(componente.formularioEdicion.value.cantidadTotal).toBe(2);
      expect(componente.formularioEdicion.value.pvp).toBe(45000);
      expect(componente.formularioEdicion.value.porcentajeDescuentoEditorial).toBe(35);
    });

    it('muestra los dos paneles del formulario: Ubicación del libro e Información del libro', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);
      fixture.detectChanges();

      const texto = fixture.nativeElement.textContent;
      expect(texto).toContain('Ubicación del libro');
      expect(texto).toContain('Información del libro');
    });

    it('el botón "Escanear ISBN" del formulario completa el campo isbn con el resultado del scanner', async () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);
      fixture.detectChanges();

      botonPorTexto(fixture, 'Escanear ISBN')?.click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);
      callbackDecodificacion?.({ getText: () => '9781234567897' });
      fixture.detectChanges();

      expect(componente.formularioEdicion.value.isbn).toBe('9781234567897');
      expect(componente.escaneandoEdicion()).toBe(false);
      expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
    });

    it('cambiar el Espacio limpia Mueble y Ubicación (cascada)', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);

      componente.alCambiarEditEspacio();

      expect(componente.editMuebleId()).toBe('');
      expect(componente.editUbicacionId()).toBe('');
    });

    it('cancelar la edición vuelve a la lista sin guardar', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);

      componente.cancelarEdicion();
      fixture.detectChanges();

      expect(componente.libroEditandoId()).toBeNull();
      expect(fixture.nativeElement.querySelector('form')).toBeFalsy();
    });

    it('guardarEdicion llama a LibrosService.editarLibro con TODOS los campos del libro', async () => {
      const { fixture, editarLibroMock } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);
      componente.formularioEdicion.setValue({
        isbn: '9781234567897',
        titulo: 'Cien años de soledad (editado)',
        autor: 'G. García Márquez',
        editorial: 'Otra editorial',
        portadaUrl: 'https://example.com/portada.jpg',
        cantidadTotal: 5,
        pvp: 60000,
        porcentajeDescuentoEditorial: 40,
      });

      await componente.guardarEdicion();

      expect(editarLibroMock).toHaveBeenCalledWith('libro-1', {
        isbn: '9781234567897',
        titulo: 'Cien años de soledad (editado)',
        autor: 'G. García Márquez',
        editorial: 'Otra editorial',
        portadaUrl: 'https://example.com/portada.jpg',
        ubicacionId: 'ubicacion-1',
        cantidadTotal: 5,
        pvp: 60000,
        porcentajeDescuentoEditorial: 40,
      });
      expect(componente.libroEditandoId()).toBeNull();
    });

    it('envía isbn/editorial/portadaUrl como null cuando quedan vacíos', async () => {
      const { fixture, editarLibroMock } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);
      componente.formularioEdicion.setValue({
        isbn: '',
        titulo: 'Cien años de soledad',
        autor: 'Gabriel García Márquez',
        editorial: '',
        portadaUrl: '',
        cantidadTotal: 2,
        pvp: 45000,
        porcentajeDescuentoEditorial: 35,
      });

      await componente.guardarEdicion();

      expect(editarLibroMock).toHaveBeenCalledWith(
        'libro-1',
        expect.objectContaining({ isbn: null, editorial: null, portadaUrl: null }),
      );
    });

    it('muestra un mensaje y no llama a la API si no se seleccionó una ubicación completa', async () => {
      const { fixture, editarLibroMock } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.libroEditandoId.set('libro-1');
      componente.formularioEdicion.setValue({
        isbn: '',
        titulo: 'Cien años de soledad',
        autor: 'Gabriel García Márquez',
        editorial: '',
        portadaUrl: '',
        cantidadTotal: 5,
        pvp: 60000,
        porcentajeDescuentoEditorial: 40,
      });
      // Sin cascada resuelta: editUbicacionId queda en '' por defecto.

      await componente.guardarEdicion();

      expect(editarLibroMock).not.toHaveBeenCalled();
      expect(componente.mensajeError()).toContain('Selecciona Espacio, Mueble y Ubicación');
    });

    it('muestra el mensaje de error del backend cuando editarLibro falla', async () => {
      const { fixture, editarLibroMock } = configurarPrueba();
      editarLibroMock.mockResolvedValue({ exito: false, error: 'La ubicación indicada no existe.' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroFalso);

      await componente.guardarEdicion();
      fixture.detectChanges();

      expect(componente.mensajeError()).toBe('La ubicación indicada no existe.');
      // No vuelve a la lista si falló.
      expect(componente.libroEditandoId()).toBe('libro-1');
    });
  });

  describe('eliminar un libro (solo administrador)', () => {
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      confirmSpy = vi.spyOn(window, 'confirm');
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    it('pide confirmación y llama a LibrosService.eliminarLibro cuando se confirma', async () => {
      confirmSpy.mockReturnValue(true);
      const { fixture, eliminarLibroMock } = configurarPrueba({ rol: administradorFalso });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      await componente.eliminar(libroFalso);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(eliminarLibroMock).toHaveBeenCalledWith('libro-1');
      expect(componente.mensajeExito()).toBe('Libro eliminado correctamente.');
    });

    it('no llama a la API si se cancela la confirmación', async () => {
      confirmSpy.mockReturnValue(false);
      const { fixture, eliminarLibroMock } = configurarPrueba({ rol: administradorFalso });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      await componente.eliminar(libroFalso);

      expect(eliminarLibroMock).not.toHaveBeenCalled();
    });

    it('muestra el mensaje de error del backend cuando eliminarLibro falla', async () => {
      confirmSpy.mockReturnValue(true);
      const { fixture, eliminarLibroMock } = configurarPrueba({ rol: administradorFalso });
      eliminarLibroMock.mockResolvedValue({
        exito: false,
        error: 'Este correo no está autorizado para eliminar libros en Babel.',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      await componente.eliminar(libroFalso);

      expect(componente.mensajeError()).toBe('Este correo no está autorizado para eliminar libros en Babel.');
    });
  });

  describe('selector manual de portada', () => {
    function botonActualizarPortada(fixture: ComponentFixture<EditarLibroComponent>): HTMLButtonElement | null {
      return fixture.nativeElement.querySelector('button[aria-label="Buscar otra portada"]');
    }

    /** Mismo patrón que `catalogar-libro.component.spec.ts`: un evento `input` real, no mutar el FormControl a mano — es lo que efectivamente dispara la actualización del `@if` que lee `formularioEdicion.controls.X.value`. */
    function escribirEnCampo(fixture: ComponentFixture<EditarLibroComponent>, id: string, valor: string): void {
      const campo = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('el thumbnail de portada aparece al editar un libro que ya tiene portadaUrl, y no aparece sin portada', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.editar(libroFalso); // portadaUrl vacío
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('img[alt]')).toBeNull();

      componente.editar(libroConPortada);
      fixture.detectChanges();
      const img = fixture.nativeElement.querySelector('img[alt]') as HTMLImageElement;
      expect(img.src).toBe(libroConPortada.portadaUrl);
    });

    it('el botón de actualizar portada está deshabilitado sin ISBN, habilitado con ISBN presente', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar({ ...libroConPortada, isbn: null });
      fixture.detectChanges();

      expect(botonActualizarPortada(fixture)?.disabled).toBe(true);

      escribirEnCampo(fixture, 'editIsbn', '9780000000001');

      expect(botonActualizarPortada(fixture)?.disabled).toBe(false);
    });

    it('clic en el botón abre el selector y busca portadas con el isbn actual', async () => {
      const { fixture, buscarPortadasMock } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroConPortada);
      fixture.detectChanges();

      botonActualizarPortada(fixture)?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(buscarPortadasMock).toHaveBeenCalledWith(libroConPortada.isbn);
      expect(fixture.nativeElement.textContent).toContain('Elegir portada');
    });

    it('seleccionar una portada en el diálogo actualiza portadaUrl y lo cierra', async () => {
      const { fixture, buscarPortadasMock } = configurarPrueba();
      buscarPortadasMock.mockResolvedValue([
        { dominio: 'www.tornamesa.co', nombre: 'Tornamesa', portadaUrl: 'https://tornamesa.co/nueva.jpg' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.editar(libroConPortada);
      fixture.detectChanges();

      botonActualizarPortada(fixture)?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const tarjeta = Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
        (boton as HTMLElement).textContent?.includes('Tornamesa'),
      ) as HTMLButtonElement;
      tarjeta.click();
      fixture.detectChanges();

      const botonCambiar = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLElement).textContent?.trim() === 'Cambiar',
      ) as HTMLButtonElement;
      botonCambiar.click();
      fixture.detectChanges();

      expect(componente.formularioEdicion.value.portadaUrl).toBe('https://tornamesa.co/nueva.jpg');
      expect(componente.selectorPortadaVisible()).toBe(false);
    });
  });
});
