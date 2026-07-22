import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EditorialesDescuentosService } from '../../core/api/editoriales-descuentos.service';
import type { DescuentoEditorial } from '../../core/models/descuento-editorial.model';
import { GestionDescuentosEditorialesComponent } from './gestion-descuentos-editoriales.component';

const planeta: DescuentoEditorial = {
  editorial: 'Planeta',
  porcentajePorDefecto: 35,
  porcentajesDisponibles: [35, 40, 45],
};

const independiente: DescuentoEditorial = {
  editorial: 'Independiente',
  porcentajePorDefecto: 20,
  porcentajesDisponibles: [],
};

function configurarPrueba(opciones: { descuentos?: DescuentoEditorial[]; error?: boolean } = {}) {
  const cargarDescuentosMock = vi.fn().mockResolvedValue(undefined);
  const crearDescuentoMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarDescuentoMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarDescuentoMock = vi.fn().mockResolvedValue({ exito: true });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: EditorialesDescuentosService,
        useValue: {
          descuentos: signal(opciones.descuentos ?? [planeta, independiente]),
          error: signal(opciones.error ?? false),
          cargarDescuentos: cargarDescuentosMock,
          crearDescuento: crearDescuentoMock,
          actualizarDescuento: actualizarDescuentoMock,
          eliminarDescuento: eliminarDescuentoMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<GestionDescuentosEditorialesComponent> = TestBed.createComponent(
    GestionDescuentosEditorialesComponent,
  );
  fixture.detectChanges();

  return { fixture, cargarDescuentosMock, crearDescuentoMock, actualizarDescuentoMock, eliminarDescuentoMock };
}

function botones(fixture: ComponentFixture<GestionDescuentosEditorialesComponent>, texto: string): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).filter(
    (boton) => (boton as HTMLElement).textContent?.trim() === texto,
  ) as HTMLButtonElement[];
}

function botonAgregar(fixture: ComponentFixture<GestionDescuentosEditorialesComponent>): HTMLButtonElement {
  return botones(fixture, 'Agregar')[0];
}

/** Fila `<li>` de una editorial, localizada por su nombre visible. */
function fila(fixture: ComponentFixture<GestionDescuentosEditorialesComponent>, editorial: string): HTMLLIElement {
  return Array.from(fixture.nativeElement.querySelectorAll('li')).find((li) =>
    (li as HTMLElement).textContent?.includes(editorial),
  ) as HTMLLIElement;
}

function botonEnFila(fila: HTMLLIElement, texto: string): HTMLButtonElement {
  return Array.from(fila.querySelectorAll('button')).find(
    (boton) => (boton as HTMLElement).textContent?.trim().startsWith(texto),
  ) as HTMLButtonElement;
}

function llenarFormulario(
  fixture: ComponentFixture<GestionDescuentosEditorialesComponent>,
  valores: { editorial: string; porcentajePorDefecto: number; porcentajesDisponibles: string },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(valores);
}

function enviarFormulario(fixture: ComponentFixture<GestionDescuentosEditorialesComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

describe('GestionDescuentosEditorialesComponent', () => {
  it('carga las editoriales al inicializar y las lista', () => {
    const { fixture, cargarDescuentosMock } = configurarPrueba();

    expect(cargarDescuentosMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Planeta');
    expect(fixture.nativeElement.textContent).toContain('Independiente');
  });

  it('muestra un mensaje cuando falla la carga de editoriales', () => {
    const { fixture } = configurarPrueba({ descuentos: [], error: true });

    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar las editoriales.');
  });

  it('muestra el porcentaje por defecto y los porcentajes disponibles de cada fila', () => {
    const { fixture } = configurarPrueba();

    expect(fila(fixture, 'Planeta').textContent).toContain('Por defecto: 35%');
    expect(fila(fixture, 'Planeta').textContent).toContain('Disponibles: 35, 40, 45%');
    expect(fila(fixture, 'Independiente').textContent).toContain('Disponibles: Ninguno');
  });

  it('el formulario está oculto por defecto', () => {
    const { fixture } = configurarPrueba();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('el botón "Agregar" abre el formulario vacío en modo crear, con editorial habilitado', () => {
    const { fixture } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    const formulario = fixture.nativeElement.querySelector('form');
    expect(formulario).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nueva editorial');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instancia = fixture.componentInstance as any;
    expect(instancia.formulario.getRawValue()).toEqual({
      editorial: '',
      porcentajePorDefecto: 0,
      porcentajesDisponibles: '',
    });
    expect(instancia.formulario.controls.editorial.disabled).toBe(false);
  });

  it('el botón "Editar" precarga el formulario con editorial deshabilitado y el string de porcentajes unido por coma', () => {
    const { fixture } = configurarPrueba();

    botonEnFila(fila(fixture, 'Planeta'), 'Editar').click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instancia = fixture.componentInstance as any;
    expect(instancia.formulario.getRawValue()).toEqual({
      editorial: 'Planeta',
      porcentajePorDefecto: 35,
      porcentajesDisponibles: '35, 40, 45',
    });
    expect(instancia.formulario.controls.editorial.disabled).toBe(true);
  });

  it('crea una editorial nueva parseando el string de porcentajes a number[] y cierra el formulario', async () => {
    const { fixture, crearDescuentoMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { editorial: 'Nueva', porcentajePorDefecto: 30, porcentajesDisponibles: '35,  40 ,45' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearDescuentoMock).toHaveBeenCalledWith({
      editorial: 'Nueva',
      porcentajePorDefecto: 30,
      porcentajesDisponibles: [35, 40, 45],
    });
    expect(fixture.nativeElement.textContent).toContain('Descuento editorial creado correctamente.');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('crea una editorial con porcentajesDisponibles vacío cuando el campo se deja en blanco', async () => {
    const { fixture, crearDescuentoMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { editorial: 'SinAlternativas', porcentajePorDefecto: 20, porcentajesDisponibles: '' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearDescuentoMock).toHaveBeenCalledWith({
      editorial: 'SinAlternativas',
      porcentajePorDefecto: 20,
      porcentajesDisponibles: [],
    });
  });

  it('no envía la petición de creación cuando el porcentaje por defecto está fuera de rango', () => {
    const { fixture, crearDescuentoMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { editorial: 'Nueva', porcentajePorDefecto: 150, porcentajesDisponibles: '' });
    enviarFormulario(fixture);

    expect(crearDescuentoMock).not.toHaveBeenCalled();
  });

  it('no envía la petición de creación cuando porcentajesDisponibles contiene un valor fuera de rango', () => {
    const { fixture, crearDescuentoMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { editorial: 'Nueva', porcentajePorDefecto: 30, porcentajesDisponibles: '35, 150' });
    enviarFormulario(fixture);
    fixture.detectChanges();

    expect(crearDescuentoMock).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Cada porcentaje debe ser un número entre 0 y 100.');
  });

  it('no envía la petición de creación cuando porcentajesDisponibles contiene un valor no numérico', () => {
    const { fixture, crearDescuentoMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { editorial: 'Nueva', porcentajePorDefecto: 30, porcentajesDisponibles: '35, abc' });
    enviarFormulario(fixture);

    expect(crearDescuentoMock).not.toHaveBeenCalled();
  });

  it('actualiza una editorial existente y cierra el formulario', async () => {
    const { fixture, actualizarDescuentoMock } = configurarPrueba();

    botonEnFila(fila(fixture, 'Planeta'), 'Editar').click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formulario = (fixture.componentInstance as any).formulario;
    formulario.patchValue({ porcentajePorDefecto: 40, porcentajesDisponibles: '40, 45' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(actualizarDescuentoMock).toHaveBeenCalledWith('Planeta', {
      porcentajePorDefecto: 40,
      porcentajesDisponibles: [40, 45],
    });
    expect(fixture.nativeElement.textContent).toContain('Descuento editorial actualizado correctamente.');
  });

  it('elimina una editorial tras confirmar y muestra el mensaje de éxito', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarDescuentoMock } = configurarPrueba();

    botonEnFila(fila(fixture, 'Planeta'), 'Eliminar').click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(eliminarDescuentoMock).toHaveBeenCalledWith('Planeta');
    expect(fixture.nativeElement.textContent).toContain('Descuento editorial eliminado correctamente.');
  });

  it('no elimina la editorial cuando se cancela la confirmación', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, eliminarDescuentoMock } = configurarPrueba();

    botonEnFila(fila(fixture, 'Planeta'), 'Eliminar').click();
    await Promise.resolve();

    expect(eliminarDescuentoMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de error cuando crearDescuento falla (409)', async () => {
    const { fixture, crearDescuentoMock } = configurarPrueba();
    crearDescuentoMock.mockResolvedValue({
      exito: false,
      error: 'Ya existe una configuración de descuento para esa editorial.',
    });

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { editorial: 'Planeta', porcentajePorDefecto: 35, porcentajesDisponibles: '' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ya existe una configuración de descuento para esa editorial.');
  });
});
