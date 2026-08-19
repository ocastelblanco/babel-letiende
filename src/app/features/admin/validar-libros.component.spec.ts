import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ResultadoIniciarValidacion,
  ValidacionesLibrosService,
} from '../../core/api/validaciones-libros.service';
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

function configurarPrueba(opciones: { ultimoValidacionId?: string | null } = {}) {
  const iniciarValidacionMock = vi.fn<() => Promise<ResultadoIniciarValidacion>>();
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
    ],
  });

  const fixture: ComponentFixture<ValidarLibrosComponent> = TestBed.createComponent(ValidarLibrosComponent);

  return { fixture, iniciarValidacionMock, consultarValidacionMock };
}

function botonIniciar(fixture: ComponentFixture<ValidarLibrosComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement;
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

  it('al hacer clic en "Iniciar validación", arranca el polling con el validacionId nuevo', async () => {
    const { fixture, iniciarValidacionMock, consultarValidacionMock } = configurarPrueba();
    iniciarValidacionMock.mockResolvedValue({ iniciada: true, validacionId: 'v-nueva' });
    consultarValidacionMock.mockResolvedValue(resumenEnProgreso);

    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    botonIniciar(fixture).click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(iniciarValidacionMock).toHaveBeenCalledTimes(1);
    expect(consultarValidacionMock).toHaveBeenCalledWith('v-nueva');
    expect(botonIniciar(fixture).disabled).toBe(true);
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
