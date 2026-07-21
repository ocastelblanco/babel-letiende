import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EstantesService } from '../../core/api/estantes.service';
import type { Estante } from '../../core/models/estante.model';
import { GestionEstantesComponent } from './gestion-estantes.component';

const estanteFalso: Estante = {
  estanteId: 'estante-1',
  espacio: 'Espacio principal',
  mueble: 'Biblioteca 1',
  ubicacion: 'Estante 1',
};

function configurarPrueba(opciones: { estantes?: Estante[]; error?: boolean } = {}) {
  const cargarEstantesMock = vi.fn().mockResolvedValue(undefined);
  const crearEstanteMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarEstanteMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarEstanteMock = vi.fn().mockResolvedValue({ exito: true });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: EstantesService,
        useValue: {
          estantes: signal(opciones.estantes ?? [estanteFalso]),
          error: signal(opciones.error ?? false),
          cargarEstantes: cargarEstantesMock,
          crearEstante: crearEstanteMock,
          actualizarEstante: actualizarEstanteMock,
          eliminarEstante: eliminarEstanteMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<GestionEstantesComponent> = TestBed.createComponent(GestionEstantesComponent);
  fixture.detectChanges();

  return { fixture, cargarEstantesMock, crearEstanteMock, actualizarEstanteMock, eliminarEstanteMock };
}

function llenarFormulario(fixture: ComponentFixture<GestionEstantesComponent>, valores: { espacio: string; mueble: string; ubicacion: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(valores);
}

function enviarFormulario(fixture: ComponentFixture<GestionEstantesComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

describe('GestionEstantesComponent', () => {
  it('carga los estantes al inicializar y los lista', () => {
    const { fixture, cargarEstantesMock } = configurarPrueba();

    expect(cargarEstantesMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Espacio principal — Biblioteca 1 — Estante 1');
  });

  it('muestra un mensaje cuando falla la carga de estantes', () => {
    const { fixture } = configurarPrueba({ estantes: [], error: true });

    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar los estantes.');
  });

  it('crea un estante nuevo con los datos del formulario y muestra el mensaje de éxito', async () => {
    const { fixture, crearEstanteMock } = configurarPrueba();

    llenarFormulario(fixture, { espacio: 'Terraza', mueble: 'Exhibidor 1', ubicacion: 'Nivel 1' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearEstanteMock).toHaveBeenCalledWith({ espacio: 'Terraza', mueble: 'Exhibidor 1', ubicacion: 'Nivel 1' });
    expect(fixture.nativeElement.textContent).toContain('Estante creado correctamente.');
  });

  it('no envía la petición de creación cuando el formulario es inválido', () => {
    const { fixture, crearEstanteMock } = configurarPrueba();

    enviarFormulario(fixture);

    expect(crearEstanteMock).not.toHaveBeenCalled();
  });

  it('precarga el formulario al editar y llama a actualizarEstante con el estanteId correcto', async () => {
    const { fixture, actualizarEstanteMock } = configurarPrueba();

    const botonEditar = fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement;
    botonEditar.click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((fixture.componentInstance as any).formulario.value).toEqual({
      espacio: 'Espacio principal',
      mueble: 'Biblioteca 1',
      ubicacion: 'Estante 1',
    });

    llenarFormulario(fixture, { espacio: 'Espacio principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 2' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(actualizarEstanteMock).toHaveBeenCalledWith('estante-1', {
      espacio: 'Espacio principal',
      mueble: 'Biblioteca 1',
      ubicacion: 'Estante 2',
    });
    expect(fixture.nativeElement.textContent).toContain('Estante actualizado correctamente.');
  });

  it('elimina un estante tras confirmar y muestra el mensaje de éxito', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarEstanteMock } = configurarPrueba();

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonEliminar = botones[botones.length - 1] as HTMLButtonElement;
    botonEliminar.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(eliminarEstanteMock).toHaveBeenCalledWith('estante-1');
    expect(fixture.nativeElement.textContent).toContain('Estante eliminado correctamente.');
  });

  it('no elimina el estante cuando el usuario cancela la confirmación', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, eliminarEstanteMock } = configurarPrueba();

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonEliminar = botones[botones.length - 1] as HTMLButtonElement;
    botonEliminar.click();
    await Promise.resolve();

    expect(eliminarEstanteMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de error cuando crearEstante falla', async () => {
    const { fixture, crearEstanteMock } = configurarPrueba();
    crearEstanteMock.mockResolvedValue({ exito: false, error: 'Este correo no está autorizado para administrar estantes en Babel.' });

    llenarFormulario(fixture, { espacio: 'Terraza', mueble: 'Exhibidor 1', ubicacion: 'Nivel 1' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Este correo no está autorizado para administrar estantes en Babel.');
  });

  it('muestra el mensaje de error cuando eliminarEstante falla', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarEstanteMock } = configurarPrueba();
    eliminarEstanteMock.mockResolvedValue({ exito: false, error: 'El estante no existe.' });

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonEliminar = botones[botones.length - 1] as HTMLButtonElement;
    botonEliminar.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('El estante no existe.');
  });
});
