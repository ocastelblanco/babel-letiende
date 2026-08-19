import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MetadatosService, PortadaCandidata } from '../../core/api/metadatos.service';
import { SelectorPortadaComponent } from './selector-portada.component';

const candidatos: PortadaCandidata[] = [
  { dominio: 'www.librerialerner.com.co', nombre: 'Librería Lerner', portadaUrl: 'https://lerner.com/portada.jpg' },
  { dominio: 'www.tornamesa.co', nombre: 'Tornamesa', portadaUrl: 'https://tornamesa.co/portada.jpg' },
];

function configurarPrueba() {
  const buscarPortadasMock = vi.fn().mockResolvedValue([]);

  TestBed.configureTestingModule({
    providers: [{ provide: MetadatosService, useValue: { buscarPortadas: buscarPortadasMock } }],
  });

  const fixture: ComponentFixture<SelectorPortadaComponent> = TestBed.createComponent(SelectorPortadaComponent);
  return { fixture, buscarPortadasMock };
}

function establecerInputs(fixture: ComponentFixture<SelectorPortadaComponent>, isbn: string, visible: boolean): void {
  fixture.componentRef.setInput('isbn', isbn);
  fixture.componentRef.setInput('visible', visible);
  fixture.detectChanges();
}

describe('SelectorPortadaComponent', () => {
  it('no renderiza nada cuando visible es false', () => {
    const { fixture } = configurarPrueba();

    establecerInputs(fixture, '9780000000001', false);

    expect(fixture.nativeElement.querySelector('h2')).toBeNull();
  });

  it('dispara la búsqueda con el isbn al volverse visible', async () => {
    const { fixture, buscarPortadasMock } = configurarPrueba();

    establecerInputs(fixture, '9780000000001', true);
    await fixture.whenStable();

    expect(buscarPortadasMock).toHaveBeenCalledWith('9780000000001');
  });

  it('muestra "Buscando portadas…" mientras la promesa está pendiente', () => {
    const { fixture, buscarPortadasMock } = configurarPrueba();
    buscarPortadasMock.mockReturnValue(new Promise(() => {})); // nunca resuelve

    establecerInputs(fixture, '9780000000001', true);

    expect(fixture.nativeElement.textContent).toContain('Buscando portadas');
  });

  it('muestra una tarjeta por cada candidato encontrado', async () => {
    const { fixture, buscarPortadasMock } = configurarPrueba();
    buscarPortadasMock.mockResolvedValue(candidatos);

    establecerInputs(fixture, '9780000000001', true);
    await fixture.whenStable();
    fixture.detectChanges();

    const tarjetas = fixture.nativeElement.querySelectorAll('img');
    expect(tarjetas.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Librería Lerner');
    expect(fixture.nativeElement.textContent).toContain('Tornamesa');
  });

  it('muestra un mensaje de "sin resultados" cuando no hay candidatos', async () => {
    const { fixture, buscarPortadasMock } = configurarPrueba();
    buscarPortadasMock.mockResolvedValue([]);

    establecerInputs(fixture, '9780000000001', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No se encontraron portadas alternativas.');
  });

  it('el botón "Cambiar" está deshabilitado hasta elegir una tarjeta, y emite portadaSeleccionada + cerrar al confirmar', async () => {
    const { fixture, buscarPortadasMock } = configurarPrueba();
    buscarPortadasMock.mockResolvedValue(candidatos);
    establecerInputs(fixture, '9780000000001', true);
    await fixture.whenStable();
    fixture.detectChanges();

    const portadaSeleccionadaEmitida = vi.fn();
    const cerrarEmitido = vi.fn();
    fixture.componentInstance.portadaSeleccionada.subscribe(portadaSeleccionadaEmitida);
    fixture.componentInstance.cerrar.subscribe(cerrarEmitido);

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonCambiar = Array.from(botones).find(
      (boton) => (boton as HTMLElement).textContent?.trim() === 'Cambiar',
    ) as HTMLButtonElement;
    expect(botonCambiar.disabled).toBe(true);

    const tarjetaLerner = Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
      (boton as HTMLElement).textContent?.includes('Librería Lerner'),
    ) as HTMLButtonElement;
    tarjetaLerner.click();
    fixture.detectChanges();

    expect(botonCambiar.disabled).toBe(false);

    botonCambiar.click();

    expect(portadaSeleccionadaEmitida).toHaveBeenCalledWith('https://lerner.com/portada.jpg');
    expect(cerrarEmitido).not.toHaveBeenCalled();
  });

  it('el botón "Cancelar" solo emite cerrar, sin portadaSeleccionada', async () => {
    const { fixture, buscarPortadasMock } = configurarPrueba();
    buscarPortadasMock.mockResolvedValue(candidatos);
    establecerInputs(fixture, '9780000000001', true);
    await fixture.whenStable();
    fixture.detectChanges();

    const portadaSeleccionadaEmitida = vi.fn();
    const cerrarEmitido = vi.fn();
    fixture.componentInstance.portadaSeleccionada.subscribe(portadaSeleccionadaEmitida);
    fixture.componentInstance.cerrar.subscribe(cerrarEmitido);

    const botones = fixture.nativeElement.querySelectorAll('button[type="button"]');
    const botonCancelar = Array.from(botones).find(
      (boton) => (boton as HTMLElement).textContent?.trim() === 'Cancelar',
    ) as HTMLButtonElement;
    botonCancelar.click();

    expect(cerrarEmitido).toHaveBeenCalledTimes(1);
    expect(portadaSeleccionadaEmitida).not.toHaveBeenCalled();
  });
});
