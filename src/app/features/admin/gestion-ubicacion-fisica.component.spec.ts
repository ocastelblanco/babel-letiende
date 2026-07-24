import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import type { Espacio } from '../../core/models/espacio.model';
import type { Mueble } from '../../core/models/mueble.model';
import type { Ubicacion } from '../../core/models/ubicacion.model';
import { GestionUbicacionFisicaComponent } from './gestion-ubicacion-fisica.component';

const espacioPrincipal: Espacio = { espacioId: 'e1', nombre: 'Espacio principal' };
const espacioTerraza: Espacio = { espacioId: 'e2', nombre: 'Exhibidor terraza' };

const muebleBiblioteca: Mueble = { muebleId: 'm1', espacioId: 'e1', nombre: 'Biblioteca 1' };
const muebleMesa: Mueble = { muebleId: 'm2', espacioId: 'e2', nombre: 'Mesa de descuentos' };

const ubicacionEstante: Ubicacion = { ubicacionId: 'u1', muebleId: 'm1', nombre: 'Estante 1' };

function configurarPrueba(
  opciones: {
    espacios?: Espacio[];
    muebles?: Mueble[];
    ubicaciones?: Ubicacion[];
    errorEspacios?: boolean;
    errorMuebles?: boolean;
    errorUbicaciones?: boolean;
  } = {},
) {
  const cargarEspaciosMock = vi.fn().mockResolvedValue(undefined);
  const crearEspacioMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarEspacioMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarEspacioMock = vi.fn().mockResolvedValue({ exito: true });

  const cargarMueblesMock = vi.fn().mockResolvedValue(undefined);
  const crearMuebleMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarMuebleMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarMuebleMock = vi.fn().mockResolvedValue({ exito: true });

  const cargarUbicacionesMock = vi.fn().mockResolvedValue(undefined);
  const crearUbicacionMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarUbicacionMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarUbicacionMock = vi.fn().mockResolvedValue({ exito: true });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal(opciones.espacios ?? [espacioPrincipal]),
          errorEspacios: signal(opciones.errorEspacios ?? false),
          cargarEspacios: cargarEspaciosMock,
          crearEspacio: crearEspacioMock,
          actualizarEspacio: actualizarEspacioMock,
          eliminarEspacio: eliminarEspacioMock,

          muebles: signal(opciones.muebles ?? [muebleBiblioteca]),
          errorMuebles: signal(opciones.errorMuebles ?? false),
          cargarMuebles: cargarMueblesMock,
          crearMueble: crearMuebleMock,
          actualizarMueble: actualizarMuebleMock,
          eliminarMueble: eliminarMuebleMock,

          ubicaciones: signal(opciones.ubicaciones ?? [ubicacionEstante]),
          errorUbicaciones: signal(opciones.errorUbicaciones ?? false),
          cargarUbicaciones: cargarUbicacionesMock,
          crearUbicacion: crearUbicacionMock,
          actualizarUbicacion: actualizarUbicacionMock,
          eliminarUbicacion: eliminarUbicacionMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<GestionUbicacionFisicaComponent> = TestBed.createComponent(
    GestionUbicacionFisicaComponent,
  );
  fixture.detectChanges();

  return {
    fixture,
    cargarEspaciosMock,
    crearEspacioMock,
    actualizarEspacioMock,
    eliminarEspacioMock,
    cargarMueblesMock,
    crearMuebleMock,
    actualizarMuebleMock,
    eliminarMuebleMock,
    cargarUbicacionesMock,
    crearUbicacionMock,
    actualizarUbicacionMock,
    eliminarUbicacionMock,
  };
}

function botonPorTexto(fixture: ComponentFixture<GestionUbicacionFisicaComponent>, texto: string): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).find(
    (boton) => (boton as HTMLElement).textContent?.trim() === texto,
  ) as HTMLButtonElement;
}

function enviarFormulario(fixture: ComponentFixture<GestionUbicacionFisicaComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function instanciaDe(fixture: ComponentFixture<GestionUbicacionFisicaComponent>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fixture.componentInstance as any;
}

describe('GestionUbicacionFisicaComponent', () => {
  it('carga las 3 entidades al inicializar y muestra la pestaña Espacios por defecto', () => {
    const { fixture, cargarEspaciosMock, cargarMueblesMock, cargarUbicacionesMock } = configurarPrueba();

    expect(cargarEspaciosMock).toHaveBeenCalledTimes(1);
    expect(cargarMueblesMock).toHaveBeenCalledTimes(1);
    expect(cargarUbicacionesMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Espacio principal');
  });

  // ---------------------------------------------------------------------
  // Pestaña Espacios
  // ---------------------------------------------------------------------

  describe('pestaña Espacios', () => {
    it('muestra un mensaje cuando falla la carga de espacios', () => {
      const { fixture } = configurarPrueba({ espacios: [], errorEspacios: true });

      expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar los espacios.');
    });

    it('el formulario está oculto por defecto', () => {
      const { fixture } = configurarPrueba();

      expect(fixture.nativeElement.querySelector('form')).toBeNull();
    });

    it('"Crear espacio" abre el formulario vacío en modo crear', () => {
      const { fixture } = configurarPrueba();

      botonPorTexto(fixture, 'Crear espacio').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Nuevo espacio');
      expect(instanciaDe(fixture).formularioEspacio.getRawValue()).toEqual({ nombre: '' });
    });

    it('"Editar" precarga el formulario con los datos del espacio', () => {
      const { fixture } = configurarPrueba();

      botonPorTexto(fixture, 'Editar').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Editar espacio');
      expect(instanciaDe(fixture).formularioEspacio.getRawValue()).toEqual({ nombre: espacioPrincipal.nombre });
    });

    it('crea un espacio nuevo y cierra el formulario', async () => {
      const { fixture, crearEspacioMock } = configurarPrueba();

      botonPorTexto(fixture, 'Crear espacio').click();
      fixture.detectChanges();
      instanciaDe(fixture).formularioEspacio.setValue({ nombre: 'Espacio nuevo' });
      enviarFormulario(fixture);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(crearEspacioMock).toHaveBeenCalledWith({ nombre: 'Espacio nuevo' });
      expect(fixture.nativeElement.textContent).toContain('Espacio creado correctamente.');
      expect(fixture.nativeElement.querySelector('form')).toBeNull();
    });

    it('actualiza un espacio existente', async () => {
      const { fixture, actualizarEspacioMock } = configurarPrueba();

      botonPorTexto(fixture, 'Editar').click();
      fixture.detectChanges();
      instanciaDe(fixture).formularioEspacio.setValue({ nombre: 'Renombrado' });
      enviarFormulario(fixture);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(actualizarEspacioMock).toHaveBeenCalledWith('e1', { nombre: 'Renombrado' });
      expect(fixture.nativeElement.textContent).toContain('Espacio actualizado correctamente.');
    });

    it('muestra el mensaje de error del backend al eliminar un espacio con muebles asociados', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { fixture, eliminarEspacioMock } = configurarPrueba();
      eliminarEspacioMock.mockResolvedValue({
        exito: false,
        error: 'No se puede eliminar un espacio que tiene muebles asociados.',
      });

      botonPorTexto(fixture, 'Eliminar').click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No se puede eliminar un espacio que tiene muebles asociados.');
    });

    it('no elimina cuando el usuario cancela la confirmación', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { fixture, eliminarEspacioMock } = configurarPrueba();

      botonPorTexto(fixture, 'Eliminar').click();
      await Promise.resolve();

      expect(eliminarEspacioMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Pestaña Muebles
  // ---------------------------------------------------------------------

  describe('pestaña Muebles', () => {
    function irAMuebles(fixture: ComponentFixture<GestionUbicacionFisicaComponent>) {
      botonPorTexto(fixture, 'Muebles').click();
      fixture.detectChanges();
    }

    it('muestra el espacio al que pertenece cada mueble', () => {
      const { fixture } = configurarPrueba({ muebles: [muebleBiblioteca], espacios: [espacioPrincipal] });

      irAMuebles(fixture);

      expect(fixture.nativeElement.textContent).toContain('Biblioteca 1');
      expect(fixture.nativeElement.textContent).toContain('Espacio principal');
    });

    it('"Crear mueble" abre el formulario vacío con el select de espacios poblado', () => {
      const { fixture } = configurarPrueba({ espacios: [espacioPrincipal, espacioTerraza] });

      irAMuebles(fixture);
      botonPorTexto(fixture, 'Crear mueble').click();
      fixture.detectChanges();

      const opciones = fixture.nativeElement.querySelectorAll('#mueble-espacio option');
      // 1 opción placeholder + 2 espacios.
      expect(opciones.length).toBe(3);
    });

    it('crea un mueble nuevo asociado a un espacio', async () => {
      const { fixture, crearMuebleMock } = configurarPrueba({ espacios: [espacioPrincipal, espacioTerraza] });

      irAMuebles(fixture);
      botonPorTexto(fixture, 'Crear mueble').click();
      fixture.detectChanges();
      instanciaDe(fixture).formularioMueble.setValue({ espacioId: 'e2', nombre: 'Mueble nuevo' });
      enviarFormulario(fixture);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(crearMuebleMock).toHaveBeenCalledWith({ espacioId: 'e2', nombre: 'Mueble nuevo' });
      expect(fixture.nativeElement.textContent).toContain('Mueble creado correctamente.');
    });

    it('"Editar" precarga el formulario, incluyendo el espacio actual, y permite reasignarlo', async () => {
      const { fixture, actualizarMuebleMock } = configurarPrueba({
        muebles: [muebleBiblioteca],
        espacios: [espacioPrincipal, espacioTerraza],
      });

      irAMuebles(fixture);
      botonPorTexto(fixture, 'Editar').click();
      fixture.detectChanges();

      expect(instanciaDe(fixture).formularioMueble.getRawValue()).toEqual({
        espacioId: muebleBiblioteca.espacioId,
        nombre: muebleBiblioteca.nombre,
      });

      instanciaDe(fixture).formularioMueble.patchValue({ espacioId: 'e2' });
      enviarFormulario(fixture);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(actualizarMuebleMock).toHaveBeenCalledWith('m1', { espacioId: 'e2', nombre: muebleBiblioteca.nombre });
    });

    it('muestra el mensaje de error del backend al eliminar un mueble con ubicaciones asociadas', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { fixture, eliminarMuebleMock } = configurarPrueba();
      eliminarMuebleMock.mockResolvedValue({
        exito: false,
        error: 'No se puede eliminar un mueble que tiene ubicaciones asociadas.',
      });

      irAMuebles(fixture);
      botonPorTexto(fixture, 'Eliminar').click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No se puede eliminar un mueble que tiene ubicaciones asociadas.');
    });
  });

  // ---------------------------------------------------------------------
  // Pestaña Ubicaciones
  // ---------------------------------------------------------------------

  describe('pestaña Ubicaciones', () => {
    function irAUbicaciones(fixture: ComponentFixture<GestionUbicacionFisicaComponent>) {
      botonPorTexto(fixture, 'Ubicaciones').click();
      fixture.detectChanges();
    }

    it('muestra el espacio y el mueble al que pertenece cada ubicación', () => {
      const { fixture } = configurarPrueba({
        ubicaciones: [ubicacionEstante],
        muebles: [muebleBiblioteca],
        espacios: [espacioPrincipal],
      });

      irAUbicaciones(fixture);

      expect(fixture.nativeElement.textContent).toContain('Estante 1');
      expect(fixture.nativeElement.textContent).toContain('Espacio principal');
      expect(fixture.nativeElement.textContent).toContain('Biblioteca 1');
    });

    it('el select de Mueble solo ofrece los muebles del Espacio elegido (cascada)', () => {
      const { fixture } = configurarPrueba({
        espacios: [espacioPrincipal, espacioTerraza],
        muebles: [muebleBiblioteca, muebleMesa],
      });

      irAUbicaciones(fixture);
      botonPorTexto(fixture, 'Crear ubicación').click();
      fixture.detectChanges();

      // Sin espacio elegido: solo el placeholder.
      expect(fixture.nativeElement.querySelectorAll('#ubicacion-mueble option').length).toBe(1);

      const selectEspacio = fixture.nativeElement.querySelector('#ubicacion-espacio') as HTMLSelectElement;
      selectEspacio.value = 'e1';
      selectEspacio.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      const opcionesMueble = Array.from(fixture.nativeElement.querySelectorAll('#ubicacion-mueble option')) as HTMLOptionElement[];
      // 1 placeholder + 1 mueble de e1 (muebleBiblioteca).
      expect(opcionesMueble.length).toBe(2);
      expect(opcionesMueble.some((opcion) => opcion.textContent?.trim() === 'Biblioteca 1')).toBe(true);
      expect(opcionesMueble.some((opcion) => opcion.textContent?.trim() === 'Mesa de descuentos')).toBe(false);
    });

    it('crea una ubicación nueva asociada a un mueble', async () => {
      const { fixture, crearUbicacionMock } = configurarPrueba({
        espacios: [espacioPrincipal],
        muebles: [muebleBiblioteca],
      });

      irAUbicaciones(fixture);
      botonPorTexto(fixture, 'Crear ubicación').click();
      fixture.detectChanges();

      const instancia = instanciaDe(fixture);
      instancia.formularioUbicacion.setValue({ espacioId: 'e1', muebleId: 'm1', nombre: 'Estante nuevo' });
      enviarFormulario(fixture);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      // Solo `nombre` y `muebleId` se envían al backend — `espacioId` es únicamente un filtro visual.
      expect(crearUbicacionMock).toHaveBeenCalledWith({ nombre: 'Estante nuevo', muebleId: 'm1' });
      expect(fixture.nativeElement.textContent).toContain('Ubicación creada correctamente.');
    });

    it('"Editar" precarga el formulario resolviendo el espacio del mueble actual y permite reasignar (cascada al cambiar espacio)', async () => {
      const { fixture, actualizarUbicacionMock } = configurarPrueba({
        ubicaciones: [ubicacionEstante],
        muebles: [muebleBiblioteca, muebleMesa],
        espacios: [espacioPrincipal, espacioTerraza],
      });

      irAUbicaciones(fixture);
      botonPorTexto(fixture, 'Editar').click();
      fixture.detectChanges();

      expect(instanciaDe(fixture).formularioUbicacion.getRawValue()).toEqual({
        espacioId: 'e1',
        muebleId: 'm1',
        nombre: 'Estante 1',
      });

      const selectEspacio = fixture.nativeElement.querySelector('#ubicacion-espacio') as HTMLSelectElement;
      selectEspacio.value = 'e2';
      selectEspacio.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // Cambiar el espacio limpia la selección de mueble anterior.
      expect(instanciaDe(fixture).formularioUbicacion.controls.muebleId.value).toBe('');

      instanciaDe(fixture).formularioUbicacion.patchValue({ muebleId: 'm2' });
      enviarFormulario(fixture);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(actualizarUbicacionMock).toHaveBeenCalledWith('u1', { nombre: 'Estante 1', muebleId: 'm2' });
    });

    it('muestra el mensaje de error del backend al eliminar una ubicación', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { fixture, eliminarUbicacionMock } = configurarPrueba();
      eliminarUbicacionMock.mockResolvedValue({ exito: false, error: 'La ubicación no existe.' });

      irAUbicaciones(fixture);
      botonPorTexto(fixture, 'Eliminar').click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('La ubicación no existe.');
    });
  });
});
