import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { LibroIndice } from '../../core/api/libros.service';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import {
  ResultadoIniciarValidacion,
  ValidacionesLibrosService,
} from '../../core/api/validaciones-libros.service';
import type { Espacio } from '../../core/models/espacio.model';
import type { Mueble } from '../../core/models/mueble.model';
import type { Ubicacion } from '../../core/models/ubicacion.model';
import type { ResumenValidacionLibros } from '../../core/models/validacion-libros.model';
import { ValidarLibrosComponent } from './validar-libros.component';

const resumenEnProgreso: ResumenValidacionLibros = {
  validacionId: 'v-1',
  estado: 'en_progreso',
  iniciadoPor: 'admin@letiende.co',
  iniciadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
  indiceActual: 5,
  totalLibros: 10,
  librosRevisados: 5,
  pvpActualizados: 1,
  portadasCorregidas: 0,
  portadasPendientes: [],
  erroresLibro: [],
  muebleActualNombre: 'Biblioteca 1',
};

const resumenCompletado: ResumenValidacionLibros = {
  ...resumenEnProgreso,
  estado: 'completado',
  indiceActual: 10,
  librosRevisados: 10,
  muebleActualNombre: null,
  portadasPendientes: [{ bookId: 'book-1', titulo: 'Libro con portada dudosa', portadaUrl: 'https://ejemplo.com/x.jpg' }],
  erroresLibro: [{ bookId: 'book-2', mensaje: 'Fallo inesperado al procesar este libro.' }],
};

const espacioPrincipal: Espacio = { espacioId: 'espacio-1', nombre: 'Sala principal' };
const espacioVip: Espacio = { espacioId: 'espacio-2', nombre: 'Sala VIP' };
const muebleBiblioteca1: Mueble = { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1' };
const muebleBiblioteca2: Mueble = { muebleId: 'mueble-2', espacioId: 'espacio-1', nombre: 'Biblioteca 2' };
const muebleVip: Mueble = { muebleId: 'mueble-3', espacioId: 'espacio-2', nombre: 'Vitrina VIP' };
const ubicacion1: Ubicacion = { ubicacionId: 'ubicacion-1', muebleId: 'mueble-1', nombre: 'Estante 1' };
const ubicacion2: Ubicacion = { ubicacionId: 'ubicacion-2', muebleId: 'mueble-2', nombre: 'Estante 2' };
const ubicacion3: Ubicacion = { ubicacionId: 'ubicacion-3', muebleId: 'mueble-3', nombre: 'Estante 3' };

const indiceFalso: LibroIndice[] = [
  { bookId: 'book-1', isbn: '111', titulo: 'Libro 1', autor: 'Autor 1', ubicacionId: 'ubicacion-1', pvp: 10000, portadaUrl: null, cantidadDisponible: 1 },
  { bookId: 'book-2', isbn: '222', titulo: 'Libro 2', autor: 'Autor 2', ubicacionId: 'ubicacion-1', pvp: 10000, portadaUrl: null, cantidadDisponible: 1 },
  { bookId: 'book-3', isbn: '333', titulo: 'Libro 3', autor: 'Autor 3', ubicacionId: 'ubicacion-2', pvp: 10000, portadaUrl: null, cantidadDisponible: 1 },
  { bookId: 'book-4', isbn: '444', titulo: 'Libro 4', autor: 'Autor 4', ubicacionId: 'ubicacion-3', pvp: 10000, portadaUrl: null, cantidadDisponible: 1 },
];

function configurarPrueba(
  opciones: {
    ultimoValidacionId?: string | null;
    espacios?: Espacio[];
    muebles?: Mueble[];
    ubicaciones?: Ubicacion[];
    indice?: LibroIndice[];
  } = {},
) {
  const iniciarValidacionMock = vi.fn<(muebleIds?: string[]) => Promise<ResultadoIniciarValidacion>>();
  const consultarValidacionMock = vi.fn<(validacionId: string) => Promise<ResumenValidacionLibros | null>>();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: ValidacionesLibrosService,
        useValue: {
          ultimoValidacionId: signal(opciones.ultimoValidacionId ?? null),
          iniciarValidacion: iniciarValidacionMock,
          consultarValidacion: consultarValidacionMock,
        },
      },
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal(opciones.espacios ?? [espacioPrincipal, espacioVip]),
          muebles: signal(opciones.muebles ?? [muebleBiblioteca1, muebleBiblioteca2, muebleVip]),
          ubicaciones: signal(opciones.ubicaciones ?? [ubicacion1, ubicacion2, ubicacion3]),
          cargarEspacios: vi.fn().mockResolvedValue(undefined),
          cargarMuebles: vi.fn().mockResolvedValue(undefined),
          cargarUbicaciones: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: LibrosService,
        useValue: {
          indice: signal(opciones.indice ?? indiceFalso),
          cargarIndice: vi.fn().mockResolvedValue(undefined),
        },
      },
    ],
  });

  const fixture: ComponentFixture<ValidarLibrosComponent> = TestBed.createComponent(ValidarLibrosComponent);

  return { fixture, iniciarValidacionMock, consultarValidacionMock };
}

function botonIniciar(fixture: ComponentFixture<ValidarLibrosComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement;
}

function selectEspacio(fixture: ComponentFixture<ValidarLibrosComponent>): HTMLSelectElement {
  return fixture.nativeElement.querySelector('#espacio-lote') as HTMLSelectElement;
}

function checkboxesMueble(fixture: ComponentFixture<ValidarLibrosComponent>): HTMLInputElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li input[type="checkbox"]')) as HTMLInputElement[];
}

function checkboxTodoElEspacio(fixture: ComponentFixture<ValidarLibrosComponent>): HTMLInputElement {
  return fixture.nativeElement.querySelector('label input[type="checkbox"]') as HTMLInputElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ValidarLibrosComponent', () => {
  it('muestra el botón "Iniciar validación" habilitado cuando no hay ninguna corrida previa', async () => {
    const { fixture } = configurarPrueba();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    expect(botonIniciar(fixture).disabled).toBe(false);
    expect(botonIniciar(fixture).textContent?.trim()).toBe('Iniciar validación');
    expect(fixture.nativeElement.textContent).toContain('No hay ninguna validación en curso');
  });

  it('al montar, retoma el polling si ultimoValidacionId sigue en_progreso', async () => {
    const { fixture, consultarValidacionMock } = configurarPrueba({ ultimoValidacionId: 'v-1' });
    consultarValidacionMock.mockResolvedValue(resumenEnProgreso);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(consultarValidacionMock).toHaveBeenCalledWith('v-1');
    expect(botonIniciar(fixture).disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Validando: Biblioteca 1');
    expect(fixture.nativeElement.textContent).toContain('5 de 10 libros revisados');
  });

  it('al montar, muestra el resumen final sin activar polling si ultimoValidacionId ya terminó', async () => {
    const { fixture, consultarValidacionMock } = configurarPrueba({ ultimoValidacionId: 'v-1' });
    consultarValidacionMock.mockResolvedValue(resumenCompletado);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(botonIniciar(fixture).disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Validación completada');

    // No debe seguir consultando después de la primera vez (sin polling activo).
    consultarValidacionMock.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(consultarValidacionMock).not.toHaveBeenCalled();
  });

  it('al hacer clic en "Iniciar validación" sin seleccionar mueble, llama iniciarValidacion con array vacío (todo el inventario)', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: true, validacionId: 'v-nueva' });
    consultarValidacionMock.mockResolvedValue(resumenEnProgreso);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.textContent).toContain('Sin selección de mueble, se validará TODO el inventario.');

    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(iniciarValidacionMock).toHaveBeenCalledTimes(1);
    expect(iniciarValidacionMock).toHaveBeenCalledWith([]);
    expect(consultarValidacionMock).toHaveBeenCalledWith('v-nueva');
    expect(botonIniciar(fixture).disabled).toBe(true);
  });

  it('seleccionar un Espacio muestra sus muebles con el conteo correcto de libros', async () => {
    const { fixture } = configurarPrueba();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    selectEspacio(fixture).value = 'espacio-1';
    selectEspacio(fixture).dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const casillas = checkboxesMueble(fixture);
    expect(casillas.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Biblioteca 1 (2 libros)');
    expect(fixture.nativeElement.textContent).toContain('Biblioteca 2 (1 libros)');
    // La Vitrina VIP pertenece a otro espacio, no debe aparecer.
    expect(fixture.nativeElement.textContent).not.toContain('Vitrina VIP');
  });

  it('marcar 2 muebles e iniciar pasa esos 2 ids a iniciarValidacion', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: true, validacionId: 'v-nueva' });
    consultarValidacionMock.mockResolvedValue(resumenEnProgreso);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    selectEspacio(fixture).value = 'espacio-1';
    selectEspacio(fixture).dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const casillas = checkboxesMueble(fixture);
    casillas[0].click();
    casillas[1].click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Se validarán 3 libros de 2 mueble(s) seleccionado(s).');

    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(iniciarValidacionMock).toHaveBeenCalledWith(['mueble-1', 'mueble-2']);
  });

  it('"Seleccionar todo el Espacio" marca y luego desmarca todos los muebles de ese espacio', async () => {
    const { fixture } = configurarPrueba();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    selectEspacio(fixture).value = 'espacio-1';
    selectEspacio(fixture).dispatchEvent(new Event('change'));
    fixture.detectChanges();

    checkboxTodoElEspacio(fixture).click();
    fixture.detectChanges();

    let casillas = checkboxesMueble(fixture);
    expect(casillas.every((casilla) => casilla.checked)).toBe(true);
    expect(checkboxTodoElEspacio(fixture).checked).toBe(true);

    checkboxTodoElEspacio(fixture).click();
    fixture.detectChanges();

    casillas = checkboxesMueble(fixture);
    expect(casillas.every((casilla) => !casilla.checked)).toBe(true);
  });

  it('cambiar de Espacio limpia la selección de muebles', async () => {
    const { fixture, iniciarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: false, validacionIdEnCurso: null, error: 'x' });

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    selectEspacio(fixture).value = 'espacio-1';
    selectEspacio(fixture).dispatchEvent(new Event('change'));
    fixture.detectChanges();

    checkboxesMueble(fixture)[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('mueble(s) seleccionado(s)');

    selectEspacio(fixture).value = 'espacio-2';
    selectEspacio(fixture).dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Sin selección de mueble, se validará TODO el inventario.');

    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(iniciarValidacionMock).toHaveBeenCalledWith([]);
  });

  it('retoma automáticamente la corrida en curso cuando iniciarValidacion responde 409', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({
      iniciada: false,
      validacionIdEnCurso: 'v-activa',
      error: 'Ya hay una validación en curso.',
    });
    consultarValidacionMock.mockResolvedValue(resumenEnProgreso);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(consultarValidacionMock).toHaveBeenCalledWith('v-activa');
    expect(botonIniciar(fixture).disabled).toBe(true);
    // El mensaje de "ya hay una en curso" no debe mostrarse como error bloqueante — se retomó en silencio.
    expect(fixture.nativeElement.textContent).not.toContain('Ya hay una validación en curso.');
  });

  it('muestra el mensaje de error cuando iniciarValidacion falla sin corrida en curso', async () => {
    const { fixture, iniciarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({
      iniciada: false,
      validacionIdEnCurso: null,
      error: 'No se pudo iniciar la validación. Intenta de nuevo.',
    });

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No se pudo iniciar la validación. Intenta de nuevo.');
    expect(botonIniciar(fixture).disabled).toBe(false);
  });

  it('detiene el polling cuando la corrida pasa a completado y muestra portadas pendientes/errores', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: true, validacionId: 'v-1' });
    consultarValidacionMock.mockResolvedValueOnce(resumenEnProgreso).mockResolvedValue(resumenCompletado);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0); // primera consulta inmediata: en_progreso
    await vi.advanceTimersByTimeAsync(3000); // segunda consulta (intervalo): completado
    fixture.detectChanges();

    expect(consultarValidacionMock).toHaveBeenCalledTimes(2);
    expect(botonIniciar(fixture).disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Libro con portada dudosa');
    expect(fixture.nativeElement.textContent).toContain('Fallo inesperado al procesar este libro.');

    // El intervalo ya se limpió — no debe seguir consultando.
    consultarValidacionMock.mockClear();
    await vi.advanceTimersByTimeAsync(9000);
    expect(consultarValidacionMock).not.toHaveBeenCalled();
  });

  it('detiene el polling y muestra un error si la corrida deja de encontrarse a mitad de camino', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: true, validacionId: 'v-1' });
    consultarValidacionMock.mockResolvedValueOnce(resumenEnProgreso).mockResolvedValue(null);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Se perdió la conexión con la validación en curso. Puedes intentar de nuevo.',
    );
    expect(botonIniciar(fixture).disabled).toBe(false);

    consultarValidacionMock.mockClear();
    await vi.advanceTimersByTimeAsync(9000);
    expect(consultarValidacionMock).not.toHaveBeenCalled();
  });

  it('limpia el intervalo de polling al destruir el componente (ngOnDestroy)', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: true, validacionId: 'v-1' });
    consultarValidacionMock.mockResolvedValue(resumenEnProgreso);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);

    fixture.destroy();
    consultarValidacionMock.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(consultarValidacionMock).not.toHaveBeenCalled();
  });
});
