import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EscanerCodigoBarrasComponent } from './escaner-codigo-barras.component';

// No hay cámara real en CI/sandbox: se mockea `BrowserMultiFormatReader` para
// controlar manualmente cuándo "llega" un resultado del scanner, sin
// depender de `getUserMedia` real — mismo patrón que
// `catalogar-libro.component.spec.ts`, de donde se extrajo este componente.
const detenerEscaneoMock = vi.fn();
let callbackDecodificacion: ((resultado: { getText: () => string } | undefined) => void) | undefined;
const decodeFromConstraintsMock = vi.fn(
  (
    _constraints: unknown,
    _video: unknown,
    callback: (resultado: { getText: () => string } | undefined) => void,
  ) => {
    callbackDecodificacion = callback;
    return Promise.resolve({ stop: detenerEscaneoMock });
  },
);

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: vi.fn(function BrowserMultiFormatReaderFalso() {
    return { decodeFromConstraints: decodeFromConstraintsMock };
  }),
}));

function botonEscanearOTexto(fixture: ComponentFixture<EscanerCodigoBarrasComponent>, texto: string): HTMLButtonElement {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).find(
    (boton) => (boton as HTMLButtonElement).textContent?.trim() === texto,
  ) as HTMLButtonElement;
}

describe('EscanerCodigoBarrasComponent', () => {
  beforeEach(() => {
    callbackDecodificacion = undefined;
    decodeFromConstraintsMock.mockClear();
    detenerEscaneoMock.mockClear();
  });

  function configurarPrueba() {
    const fixture: ComponentFixture<EscanerCodigoBarrasComponent> = TestBed.createComponent(
      EscanerCodigoBarrasComponent,
    );
    fixture.detectChanges();
    return { fixture };
  }

  it('el botón "Escanear ISBN" activa el escaneo y muestra el video de la cámara', async () => {
    const { fixture } = configurarPrueba();

    botonEscanearOTexto(fixture, 'Escanear ISBN').click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(video.classList.contains('hidden')).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Detener');
  });

  it('detiene el escaneo y libera la cámara al hacer click en "Detener"', async () => {
    const { fixture } = configurarPrueba();

    botonEscanearOTexto(fixture, 'Escanear ISBN').click();
    await Promise.resolve();
    fixture.detectChanges();

    botonEscanearOTexto(fixture, 'Detener').click();
    fixture.detectChanges();

    expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(video.classList.contains('hidden')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Escanear ISBN');
  });

  it('emite codigoDetectado con el ISBN y detiene el escaneo cuando el lector "detecta" un código', async () => {
    const { fixture } = configurarPrueba();
    const codigosEmitidos: string[] = [];
    fixture.componentInstance.codigoDetectado.subscribe((codigo) => codigosEmitidos.push(codigo));

    botonEscanearOTexto(fixture, 'Escanear ISBN').click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(callbackDecodificacion).toBeTruthy();
    callbackDecodificacion?.({ getText: () => '9780000000001' });
    fixture.detectChanges();

    expect(codigosEmitidos).toEqual(['9780000000001']);
    expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(video.classList.contains('hidden')).toBe(true);
  });

  it('muestra un mensaje de error visible cuando no hay permiso/cámara disponible', async () => {
    decodeFromConstraintsMock.mockRejectedValueOnce(new Error('Permission denied'));
    const { fixture } = configurarPrueba();

    botonEscanearOTexto(fixture, 'Escanear ISBN').click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No se pudo acceder a la cámara. Verifica los permisos o ingresa el ISBN manualmente.',
    );
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(video.classList.contains('hidden')).toBe(true);
  });

  it('detiene la cámara al destruir el componente', async () => {
    const { fixture } = configurarPrueba();

    botonEscanearOTexto(fixture, 'Escanear ISBN').click();
    await Promise.resolve();
    fixture.detectChanges();

    fixture.destroy();

    expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
  });
});
