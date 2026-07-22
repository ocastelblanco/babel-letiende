import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SitiosScrapingService } from '../../core/api/sitios-scraping.service';
import type { SitioScraping } from '../../core/models/sitio-scraping.model';
import { GestionSitiosScrapingComponent } from './gestion-sitios-scraping.component';

const sitioFalso: SitioScraping = {
  dominio: 'www.librerialerner.com.co',
  nombre: 'Librería Lerner',
  url: 'https://www.librerialerner.com.co',
  info: true,
  pvp: true,
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
          sitios: signal(opciones.sitios ?? [sitioFalso]),
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
  valores: { dominio: string; nombre: string; url: string; info: boolean; pvp: boolean; prioridad: number },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(valores);
}

function enviarFormulario(fixture: ComponentFixture<GestionSitiosScrapingComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
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

  it('crea un sitio nuevo con los datos del formulario y muestra el mensaje de éxito', async () => {
    const { fixture, crearSitioMock } = configurarPrueba();

    const nuevoSitio = {
      dominio: 'www.tornamesa.co',
      nombre: 'Tornamesa',
      url: 'https://www.tornamesa.co',
      info: true,
      pvp: true,
      prioridad: 2,
    };
    llenarFormulario(fixture, nuevoSitio);
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearSitioMock).toHaveBeenCalledWith(nuevoSitio);
    expect(fixture.nativeElement.textContent).toContain('Sitio de scraping creado correctamente.');
  });

  it('no envía la petición de creación cuando el formulario es inválido', () => {
    const { fixture, crearSitioMock } = configurarPrueba();

    enviarFormulario(fixture);

    expect(crearSitioMock).not.toHaveBeenCalled();
  });

  it('precarga el formulario al editar, deshabilita el dominio y llama a actualizarSitio sin el dominio en el body', async () => {
    const { fixture, actualizarSitioMock } = configurarPrueba();

    const botonEditar = fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement;
    botonEditar.click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formulario = (fixture.componentInstance as any).formulario;
    expect(formulario.getRawValue()).toEqual(sitioFalso);
    expect(formulario.controls.dominio.disabled).toBe(true);

    formulario.patchValue({ prioridad: 5 });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(actualizarSitioMock).toHaveBeenCalledWith('www.librerialerner.com.co', {
      nombre: sitioFalso.nombre,
      url: sitioFalso.url,
      info: sitioFalso.info,
      pvp: sitioFalso.pvp,
      prioridad: 5,
    });
    expect(fixture.nativeElement.textContent).toContain('Sitio de scraping actualizado correctamente.');
  });

  it('elimina un sitio tras confirmar y muestra el mensaje de éxito', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarSitioMock } = configurarPrueba();

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonEliminar = botones[botones.length - 1] as HTMLButtonElement;
    botonEliminar.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(eliminarSitioMock).toHaveBeenCalledWith('www.librerialerner.com.co');
    expect(fixture.nativeElement.textContent).toContain('Sitio de scraping eliminado correctamente.');
  });

  it('no elimina el sitio cuando el usuario cancela la confirmación', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, eliminarSitioMock } = configurarPrueba();

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonEliminar = botones[botones.length - 1] as HTMLButtonElement;
    botonEliminar.click();
    await Promise.resolve();

    expect(eliminarSitioMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de error cuando crearSitio falla', async () => {
    const { fixture, crearSitioMock } = configurarPrueba();
    crearSitioMock.mockResolvedValue({ exito: false, error: 'Ya existe un sitio de scraping registrado con ese dominio.' });

    llenarFormulario(fixture, {
      dominio: 'www.tornamesa.co',
      nombre: 'Tornamesa',
      url: 'https://www.tornamesa.co',
      info: true,
      pvp: true,
      prioridad: 2,
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

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonEliminar = botones[botones.length - 1] as HTMLButtonElement;
    botonEliminar.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No existe un sitio de scraping con ese dominio.');
  });
});
