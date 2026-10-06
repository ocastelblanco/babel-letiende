import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import type { Espacio } from '../../core/models/espacio.model';
import type { Libro } from '../../core/models/libro.model';
import type { Mueble } from '../../core/models/mueble.model';
import type { Ubicacion } from '../../core/models/ubicacion.model';
import { TrasladarLibrosComponent } from './trasladar-libros.component';

// `libros.service.ts` importa `auth.service.ts`, que importa el SDK real de Firebase a nivel de módulo — mismo mock que en el resto de specs.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const espacio: Espacio = { espacioId: 'e1', nombre: 'Sala' };
const mueble: Mueble = { muebleId: 'm1', espacioId: 'e1', nombre: 'Biblioteca' };
const otroMueble: Mueble = { muebleId: 'm2', espacioId: 'e1', nombre: 'Vitrina' };
const ubicacion1: Ubicacion = { ubicacionId: 'u1', muebleId: 'm1', nombre: 'Estante 1' };
const ubicacion2: Ubicacion = { ubicacionId: 'u2', muebleId: 'm1', nombre: 'Estante 2' };
const ubicacionDestino: Ubicacion = { ubicacionId: 'u3', muebleId: 'm2', nombre: 'Repisa' };

function libro(bookId: string, titulo: string, ubicacionId: string, extra: Partial<Libro> = {}): Libro {
  return {
    isbn: `isbn-${bookId}`,
    bookId,
    titulo,
    autor: 'Autor',
    editorial: null,
    portadaUrl: null,
    pvp: 40000,
    porcentajeDescuentoEditorial: 0,
    costo: 40000,
    utilidadCatalogo: 0,
    cantidadTotal: 2,
    cantidadDisponible: 2,
    ubicacionId,
    creadoPor: 'v@letiende.co',
    creadoEn: '2026-01-01T00:00:00.000Z',
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const inventarioBase: Libro[] = [
  libro('b', 'Beta', 'u1'),
  libro('a', 'Alfa', 'u1'),
  libro('c', 'Gamma', 'u2'),
  libro('d', 'Agotado', 'u1', { cantidadDisponible: 0 }),
  libro('z', 'Otro mueble', 'u3'),
];

/** Miembros `protected` del componente que las pruebas leen o accionan (la plantilla los usa; TypeScript no los expone). */
interface Interno {
  librosOrigen: () => Libro[];
  librosSeleccionados: () => Libro[];
  todasLasUbicacionesMarcadas: () => boolean;
  excluidos: () => ReadonlySet<string>;
  dialogoVisible: () => boolean;
  destinoUbicacionId: { set: (valor: string) => void };
  alCambiarOrigenEspacio: (valor: string) => void;
  alCambiarOrigenMueble: (valor: string) => void;
  alAlternarOrigenUbicacion: (id: string) => void;
  alAlternarTodasLasUbicaciones: () => void;
  alAlternarAgotados: () => void;
  alAlternarLibro: (bookId: string) => void;
  seleccionarTodos: () => void;
  seleccionarNinguno: () => void;
  abrirDialogo: () => void;
  alCambiarDestinoEspacio: (valor: string) => void;
  alCambiarDestinoMueble: (valor: string) => void;
  confirmarTraslado: () => Promise<void>;
}

function configurarPrueba(inventario: Libro[] = inventarioBase) {
  const trasladarLibrosMock = vi.fn();
  const cargarInventarioMock = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      {
        provide: LibrosService,
        useValue: {
          inventario: signal(inventario),
          cargandoInventario: signal(false),
          errorInventario: signal(false),
          cargarInventario: cargarInventarioMock,
          trasladarLibros: trasladarLibrosMock,
        },
      },
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal([espacio]),
          muebles: signal([mueble, otroMueble]),
          ubicaciones: signal([ubicacion1, ubicacion2, ubicacionDestino]),
          cargarEspacios: vi.fn().mockResolvedValue(undefined),
          cargarMuebles: vi.fn().mockResolvedValue(undefined),
          cargarUbicaciones: vi.fn().mockResolvedValue(undefined),
        },
      },
    ],
  });

  const fixture: ComponentFixture<TrasladarLibrosComponent> = TestBed.createComponent(TrasladarLibrosComponent);
  fixture.detectChanges();
  const componente = fixture.componentInstance as unknown as Interno;
  return { fixture, componente, trasladarLibrosMock, cargarInventarioMock };
}

function elegirOrigen(componente: Interno) {
  componente.alCambiarOrigenEspacio('e1');
  componente.alCambiarOrigenMueble('m1');
}

function botonPorTexto(fixture: ComponentFixture<TrasladarLibrosComponent>, texto: string): HTMLButtonElement | undefined {
  return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
    (boton) => boton.textContent?.trim() === texto,
  );
}

describe('TrasladarLibrosComponent', () => {
  it('carga inventario y ubicaciones al iniciar', () => {
    const { cargarInventarioMock } = configurarPrueba();
    expect(cargarInventarioMock).toHaveBeenCalled();
  });

  it('sin origen elegido no muestra libros ni el botón flotante', () => {
    const { fixture } = configurarPrueba();
    expect(fixture.nativeElement.querySelector('ul')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label]')).toBeNull();
  });

  it('al elegir el mueble marca todas sus ubicaciones y lista sus libros ordenados, todos seleccionados y sin agotados', () => {
    const { fixture, componente } = configurarPrueba();
    elegirOrigen(componente);
    fixture.detectChanges();

    expect(componente.todasLasUbicacionesMarcadas()).toBe(true);
    expect(componente.librosOrigen().map((l) => l.bookId)).toEqual(['a', 'b', 'c']);
    expect(componente.librosSeleccionados()).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('3 de 3 seleccionados');
    expect(fixture.nativeElement.textContent).not.toContain('Otro mueble');
    expect(fixture.nativeElement.textContent).not.toContain('Agotado');
  });

  it('"Mostrar agotados" agrega los agotados, preseleccionados', () => {
    const { fixture, componente } = configurarPrueba();
    elegirOrigen(componente);
    componente.alAlternarAgotados();
    fixture.detectChanges();

    expect(componente.librosOrigen().map((l) => l.bookId)).toContain('d');
    expect(componente.librosSeleccionados()).toHaveLength(4);
  });

  it('desmarcar una ubicación quita sus libros; "Todas" las vuelve a marcar', () => {
    const { componente } = configurarPrueba();
    elegirOrigen(componente);

    componente.alAlternarOrigenUbicacion('u2');
    expect(componente.librosOrigen().map((l) => l.bookId)).toEqual(['a', 'b']);
    expect(componente.todasLasUbicacionesMarcadas()).toBe(false);

    componente.alAlternarTodasLasUbicaciones();
    expect(componente.librosOrigen()).toHaveLength(3);
  });

  it('deseleccionar y volver a seleccionar libros actualiza el contador; ninguno / todos', () => {
    const { fixture, componente } = configurarPrueba();
    elegirOrigen(componente);

    componente.alAlternarLibro('a');
    expect(componente.librosSeleccionados().map((l) => l.bookId)).toEqual(['b', 'c']);
    componente.alAlternarLibro('a');
    expect(componente.librosSeleccionados()).toHaveLength(3);

    componente.seleccionarNinguno();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0 de 3 seleccionados');
    expect((fixture.nativeElement.querySelector('button[aria-label]') as HTMLButtonElement).disabled).toBe(true);

    componente.seleccionarTodos();
    expect(componente.librosSeleccionados()).toHaveLength(3);
  });

  it('cambiar el origen reinicia la selección (todo vuelve a quedar seleccionado)', () => {
    const { componente } = configurarPrueba();
    elegirOrigen(componente);
    componente.seleccionarNinguno();

    componente.alAlternarOrigenUbicacion('u2');
    expect(componente.librosSeleccionados()).toHaveLength(2);
  });

  it('el botón flotante abre el diálogo; Trasladar queda deshabilitado hasta elegir destino', () => {
    const { fixture, componente } = configurarPrueba();
    elegirOrigen(componente);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[aria-label]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    expect(botonPorTexto(fixture, 'Trasladar')?.disabled).toBe(true);

    componente.alCambiarDestinoEspacio('e1');
    componente.alCambiarDestinoMueble('m2');
    componente.destinoUbicacionId.set('u3');
    fixture.detectChanges();

    expect(botonPorTexto(fixture, 'Trasladar')?.disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Vas a trasladar 3 libros a Sala › Vitrina › Repisa');
  });

  it('confirmar envía solo los libros seleccionados al destino, cierra el diálogo y muestra el resumen con PVP distintos', async () => {
    const { fixture, componente, trasladarLibrosMock } = configurarPrueba();
    trasladarLibrosMock.mockResolvedValue({
      exito: true,
      resultado: {
        trasladados: ['b'],
        fusionados: [{ bookId: 'c', bookIdDestino: 'x', pvpDestino: 45000, pvpTrasladado: 50000 }],
        sinCambios: [],
        fallidos: [],
      },
    });
    elegirOrigen(componente);
    componente.alAlternarLibro('a');
    componente.abrirDialogo();
    componente.destinoUbicacionId.set('u3');

    await componente.confirmarTraslado();
    fixture.detectChanges();

    expect(trasladarLibrosMock).toHaveBeenCalledWith(['b', 'c'], 'u3');
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('1 trasladado, 1 fusionado');
    expect(texto).toContain('Gamma: destino $45.000, trasladado $50.000');
    expect(componente.excluidos().size).toBe(0);
  });

  it('un fallo por libro aparece en el resumen con su título', async () => {
    const { fixture, componente, trasladarLibrosMock } = configurarPrueba();
    trasladarLibrosMock.mockResolvedValue({
      exito: true,
      resultado: {
        trasladados: ['a', 'c'],
        fusionados: [],
        sinCambios: [],
        fallidos: [{ bookId: 'b', motivo: 'El libro cambió mientras se trasladaba (¿una venta?). Intenta de nuevo.' }],
      },
    });
    elegirOrigen(componente);
    componente.abrirDialogo();
    componente.destinoUbicacionId.set('u3');

    await componente.confirmarTraslado();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Beta — El libro cambió mientras se trasladaba');
  });

  it('si el servicio falla, el diálogo sigue abierto con el mensaje de error', async () => {
    const { fixture, componente, trasladarLibrosMock } = configurarPrueba();
    trasladarLibrosMock.mockResolvedValue({ exito: false, error: 'La ubicación indicada no existe.' });
    elegirOrigen(componente);
    componente.abrirDialogo();
    componente.destinoUbicacionId.set('u3');

    await componente.confirmarTraslado();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('La ubicación indicada no existe.');
  });

  it('no abre el diálogo ni envía nada sin libros seleccionados', async () => {
    const { componente, trasladarLibrosMock } = configurarPrueba();
    elegirOrigen(componente);
    componente.seleccionarNinguno();

    componente.abrirDialogo();
    await componente.confirmarTraslado();

    expect(componente.dialogoVisible()).toBe(false);
    expect(trasladarLibrosMock).not.toHaveBeenCalled();
  });
});
