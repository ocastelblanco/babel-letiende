import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SitiosScrapingService } from '../../core/api/sitios-scraping.service';
import type { SitioScraping } from '../../core/models/sitio-scraping.model';
import { GestionSitiosScrapingComponent } from './gestion-sitios-scraping.component';

const sitioLerner: SitioScraping = {
  dominio: 'www.librerialerner.com.co',
  nombre: 'Librería Lerner',
  url: 'https://www.librerialerner.com.co',
  info: true,
  pvp: true,
  prioridad: 2,
};

const sitioTornamesa: SitioScraping = {
  dominio: 'www.tornamesa.co',
  nombre: 'Tornamesa',
  url: 'https://www.tornamesa.co',
  info: true,
  pvp: false,
  prioridad: 1,
};

function configurarPrueba(opciones: { sitios?: SitioScraping[]; error?: boolean } = {}) {
  const cargarSitiosMock = vi.fn().mockResolvedValue(undefined);
  const crearSitioMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarSitioMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarSitioMock = vi.fn().mockResolvedValue({ exito: true });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SitiosScrapingService,
        useValue: {
          sitios: signal(opciones.sitios ?? [sitioLerner]),
          error: signal(opciones.error ?? false),
          cargarSitios: cargarSitiosMock,
          crearSitio: crearSitioMock,
          actualizarSitio: actualizarSitioMock,
          eliminarSitio: eliminarSitioMock,
        },
      },
    ],
  });

  const fixture: ComponentFixture<GestionSitiosScrapingComponent> = TestBed.createComponent(
    GestionSitiosScrapingComponent,
  );
  fixture.detectChanges();

  return { fixture, cargarSitiosMock, crearSitioMock, actualizarSitioMock, eliminarSitioMock };
}

function llenarFormulario(
  fixture: ComponentFixture<GestionSitiosScrapingComponent>,
  valores: { dominio: string; nombre: string; url: string; info: boolean; pvp: boolean },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(valores);
}

function enviarFormulario(fixture: ComponentFixture<GestionSitiosScrapingComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

/** Botón "Agregar" flota debajo del panel de lista — se ubica por texto, no por posición. */
function botonAgregar(fixture: ComponentFixture<GestionSitiosScrapingComponent>): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button[type="button"]')).find(
    (boton) => (boton as HTMLElement).textContent?.trim() === 'Agregar',
  ) as HTMLButtonElement;
}

/** Botón "Editar" de una fila — se ubica por texto (los tests que lo usan solo tienen una fila visible). */
function botonEditar(fixture: ComponentFixture<GestionSitiosScrapingComponent>): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button[type="button"]')).find(
    (boton) => (boton as HTMLElement).textContent?.trim() === 'Editar',
  ) as HTMLButtonElement;
}

/** Botón "Eliminar" de una fila — se ubica por texto (los tests que lo usan solo tienen una fila visible). */
function botonEliminar(fixture: ComponentFixture<GestionSitiosScrapingComponent>): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button[type="button"]')).find(
    (boton) => (boton as HTMLElement).textContent?.trim() === 'Eliminar',
  ) as HTMLButtonElement;
}

describe('GestionSitiosScrapingComponent', () => {
  it('carga los sitios al inicializar y los lista', () => {
    const { fixture, cargarSitiosMock } = configurarPrueba();

    expect(cargarSitiosMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Librería Lerner — www.librerialerner.com.co');
  });

  it('muestra un mensaje cuando falla la carga de sitios', () => {
    const { fixture } = configurarPrueba({ sitios: [], error: true });

    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar los sitios de scraping.');
  });

  it('ordena el listado por prioridad ascendente sin importar el orden devuelto por el backend', () => {
    const { fixture } = configurarPrueba({ sitios: [sitioLerner, sitioTornamesa] });

    const nombres = Array.from(fixture.nativeElement.querySelectorAll('li p.text-sm.text-primary')).map(
      (elemento) => (elemento as HTMLElement).textContent,
    );

    expect(nombres[0]).toContain('Tornamesa');
    expect(nombres[1]).toContain('Librería Lerner');
  });

  it('el formulario está oculto por defecto', () => {
    const { fixture } = configurarPrueba();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('el botón "Agregar" abre el formulario vacío en modo crear, sin campo de prioridad', () => {
    const { fixture } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    const formulario = fixture.nativeElement.querySelector('form');
    expect(formulario).not.toBeNull();
    expect(formulario.querySelector('#prioridad')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nuevo sitio de scraping');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instancia = fixture.componentInstance as any;
    expect(instancia.formulario.getRawValue()).toEqual({ dominio: '', nombre: '', url: '', info: false, pvp: false });
  });

  it('el botón "Agregar" se deshabilita mientras el formulario está abierto', () => {
    const { fixture } = configurarPrueba();

    expect(botonAgregar(fixture).disabled).toBe(false);

    botonAgregar(fixture).click();
    fixture.detectChanges();

    expect(botonAgregar(fixture).disabled).toBe(true);
  });

  it('el botón "Editar" abre el formulario precargado, sin campo de prioridad', () => {
    const { fixture } = configurarPrueba();

    botonEditar(fixture).click();
    fixture.detectChanges();

    const formulario = fixture.nativeElement.querySelector('form');
    expect(formulario).not.toBeNull();
    expect(formulario.querySelector('#prioridad')).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instancia = fixture.componentInstance as any;
    expect(instancia.formulario.getRawValue()).toEqual({
      dominio: sitioLerner.dominio,
      nombre: sitioLerner.nombre,
      url: sitioLerner.url,
      info: sitioLerner.info,
      pvp: sitioLerner.pvp,
    });
    expect(instancia.formulario.controls.dominio.disabled).toBe(true);
  });

  it('"Cancelar" oculta el formulario y limpia el estado de edición', () => {
    const { fixture } = configurarPrueba();

    botonEditar(fixture).click();
    fixture.detectChanges();

    const botonCancelar = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (boton) => (boton as HTMLElement).textContent?.trim() === 'Cancelar',
    ) as HTMLButtonElement;
    botonCancelar.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('crea un sitio nuevo calculando la prioridad automáticamente (máxima existente + 1) y cierra el formulario', async () => {
    const { fixture, crearSitioMock } = configurarPrueba({ sitios: [sitioLerner, sitioTornamesa] });

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, {
      dominio: 'www.nuevositio.co',
      nombre: 'Nuevo sitio',
      url: 'https://www.nuevositio.co',
      info: true,
      pvp: true,
    });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearSitioMock).toHaveBeenCalledWith({
      dominio: 'www.nuevositio.co',
      nombre: 'Nuevo sitio',
      url: 'https://www.nuevositio.co',
      info: true,
      pvp: true,
      prioridad: 3,
    });
    expect(fixture.nativeElement.textContent).toContain('Sitio de scraping creado correctamente.');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('crea el primer sitio con prioridad 1 cuando la lista está vacía', async () => {
    const { fixture, crearSitioMock } = configurarPrueba({ sitios: [] });

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, {
      dominio: 'www.nuevositio.co',
      nombre: 'Nuevo sitio',
      url: 'https://www.nuevositio.co',
      info: true,
      pvp: true,
    });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearSitioMock).toHaveBeenCalledWith(
      expect.objectContaining({ dominio: 'www.nuevositio.co', prioridad: 1 }),
    );
  });

  it('no envía la petición de creación cuando el formulario es inválido', () => {
    const { fixture, crearSitioMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();
    enviarFormulario(fixture);

    expect(crearSitioMock).not.toHaveBeenCalled();
  });

  it('al editar, reenvía la prioridad actual del sitio sin cambiarla y cierra el formulario', async () => {
    const { fixture, actualizarSitioMock } = configurarPrueba();

    botonEditar(fixture).click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formulario = (fixture.componentInstance as any).formulario;
    formulario.patchValue({ nombre: 'Librería Lerner (actualizada)' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(actualizarSitioMock).toHaveBeenCalledWith('www.librerialerner.com.co', {
      nombre: 'Librería Lerner (actualizada)',
      url: sitioLerner.url,
      info: sitioLerner.info,
      pvp: sitioLerner.pvp,
      prioridad: sitioLerner.prioridad,
    });
    expect(fixture.nativeElement.textContent).toContain('Sitio de scraping actualizado correctamente.');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('elimina un sitio tras confirmar y muestra el mensaje de éxito', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarSitioMock } = configurarPrueba();

    botonEliminar(fixture).click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(eliminarSitioMock).toHaveBeenCalledWith('www.librerialerner.com.co');
    expect(fixture.nativeElement.textContent).toContain('Sitio de scraping eliminado correctamente.');
  });

  it('no elimina el sitio cuando el usuario cancela la confirmación', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, eliminarSitioMock } = configurarPrueba();

    botonEliminar(fixture).click();
    await Promise.resolve();

    expect(eliminarSitioMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de error cuando crearSitio falla', async () => {
    const { fixture, crearSitioMock } = configurarPrueba();
    crearSitioMock.mockResolvedValue({ exito: false, error: 'Ya existe un sitio de scraping registrado con ese dominio.' });

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, {
      dominio: 'www.tornamesa.co',
      nombre: 'Tornamesa',
      url: 'https://www.tornamesa.co',
      info: true,
      pvp: true,
    });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ya existe un sitio de scraping registrado con ese dominio.');
  });

  it('muestra el mensaje de error cuando eliminarSitio falla', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarSitioMock } = configurarPrueba();
    eliminarSitioMock.mockResolvedValue({ exito: false, error: 'No existe un sitio de scraping con ese dominio.' });

    botonEliminar(fixture).click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No existe un sitio de scraping con ese dominio.');
  });

  describe('alSoltar (arrastrar y soltar)', () => {
    it('renumera y persiste la prioridad de los sitios cuyo orden cambió, en el orden final tras el arrastre', async () => {
      const sitioA: SitioScraping = { ...sitioTornamesa, dominio: 'a.com', prioridad: 1 };
      const sitioB: SitioScraping = { ...sitioTornamesa, dominio: 'b.com', prioridad: 2 };
      const sitioC: SitioScraping = { ...sitioTornamesa, dominio: 'c.com', prioridad: 3 };
      const { fixture, actualizarSitioMock } = configurarPrueba({ sitios: [sitioA, sitioB, sitioC] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instancia = fixture.componentInstance as any;

      // Simula soltar el elemento en índice 0 (a.com) en la posición 2 (al final): orden final b, c, a.
      const eventoDrop = { previousIndex: 0, currentIndex: 2 } as CdkDragDrop<SitioScraping[]>;
      await instancia.alSoltar(eventoDrop);
      fixture.detectChanges();

      // b.com pasa de prioridad 2 a 1, c.com de 3 a 2, a.com de 1 a 3: los 3 cambiaron.
      expect(actualizarSitioMock).toHaveBeenCalledTimes(3);
      expect(actualizarSitioMock).toHaveBeenCalledWith(
        'b.com',
        expect.objectContaining({ prioridad: 1 }),
      );
      expect(actualizarSitioMock).toHaveBeenCalledWith(
        'c.com',
        expect.objectContaining({ prioridad: 2 }),
      );
      expect(actualizarSitioMock).toHaveBeenCalledWith(
        'a.com',
        expect.objectContaining({ prioridad: 3 }),
      );
      expect(fixture.nativeElement.textContent).toContain('Orden actualizado correctamente.');
    });

    it('no llama a actualizarSitio cuando el índice de origen y destino son iguales', async () => {
      const { fixture, actualizarSitioMock } = configurarPrueba({ sitios: [sitioLerner, sitioTornamesa] });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instancia = fixture.componentInstance as any;
      const eventoDrop = { previousIndex: 0, currentIndex: 0 } as CdkDragDrop<SitioScraping[]>;
      await instancia.alSoltar(eventoDrop);

      expect(actualizarSitioMock).not.toHaveBeenCalled();
    });

    it('muestra un mensaje de error si alguna actualización de prioridad falla', async () => {
      const sitioA: SitioScraping = { ...sitioTornamesa, dominio: 'a.com', prioridad: 1 };
      const sitioB: SitioScraping = { ...sitioTornamesa, dominio: 'b.com', prioridad: 2 };
      const { fixture, actualizarSitioMock } = configurarPrueba({ sitios: [sitioA, sitioB] });
      actualizarSitioMock.mockResolvedValue({ exito: false, error: 'falló' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instancia = fixture.componentInstance as any;
      const eventoDrop = { previousIndex: 0, currentIndex: 1 } as CdkDragDrop<SitioScraping[]>;
      await instancia.alSoltar(eventoDrop);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'No se pudo guardar el nuevo orden de algunos sitios. Intenta de nuevo.',
      );
    });
  });
});
