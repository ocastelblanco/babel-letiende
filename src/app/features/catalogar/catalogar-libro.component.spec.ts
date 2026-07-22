import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { EstantesService } from '../../core/api/estantes.service';
import { MetadatosService } from '../../core/api/metadatos.service';
import type { Estante } from '../../core/models/estante.model';
import { CatalogarLibroComponent } from './catalogar-libro.component';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo motivo de mock que en
// `usuarios.service.spec.ts`/`estantes.service.spec.ts`.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

// No hay cámara real en CI/sandbox: se mockea `BrowserMultiFormatReader` para
// controlar manualmente cuándo "llega" un resultado del scanner, sin
// depender de `getUserMedia` real. `decodeFromConstraints` se resuelve con
// los controles falsos y guarda el callback para que la prueba lo dispare.
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

const estanteFalso: Estante = {
  estanteId: 'estante-1',
  espacio: 'Espacio principal',
  mueble: 'Biblioteca 1',
  ubicacion: 'Estante 1',
};

const datosValidos = {
  isbn: '9780000000001',
  titulo: 'Libro de prueba',
  autor: 'Autor de prueba',
  editorial: 'Editorial de prueba',
  portadaUrl: '',
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 2,
  estanteId: 'estante-1',
};

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null };

function configurarPrueba() {
  const cargarEstantesMock = vi.fn().mockResolvedValue(undefined);
  const obtenerIdTokenMock = vi.fn().mockResolvedValue('token-valido');
  // Por defecto no encuentra nada — las pruebas de autocompletado sobrescriben
  // esta resolución con `mockResolvedValueOnce`/`mockResolvedValue` según el caso.
  const obtenerMetadatosMock = vi.fn().mockResolvedValue(metadatosVacios);

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { obtenerIdToken: obtenerIdTokenMock } },
      {
        provide: EstantesService,
        useValue: {
          estantes: signal([estanteFalso]),
          error: signal(false),
          cargarEstantes: cargarEstantesMock,
        },
      },
      { provide: MetadatosService, useValue: { obtenerMetadatos: obtenerMetadatosMock } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture: ComponentFixture<CatalogarLibroComponent> = TestBed.createComponent(CatalogarLibroComponent);
  fixture.detectChanges();

  return { fixture, httpMock, obtenerIdTokenMock, cargarEstantesMock, obtenerMetadatosMock };
}

function enviarFormulario(fixture: ComponentFixture<CatalogarLibroComponent>, datos: typeof datosValidos): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(datos);
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

describe('CatalogarLibroComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    callbackDecodificacion = undefined;
    decodeFromConstraintsMock.mockClear();
    detenerEscaneoMock.mockClear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('carga los estantes al inicializar', () => {
    const resultado = configurarPrueba();
    httpMock = resultado.httpMock;

    expect(resultado.cargarEstantesMock).toHaveBeenCalledTimes(1);
  });

  it('envía POST /api/libros con el ID Token real y muestra el mensaje de éxito', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    enviarFormulario(fixture, datosValidos);
    await Promise.resolve();
    await Promise.resolve();

    const peticion = httpMock.expectOne('/api/libros');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
    expect(peticion.request.body).toEqual({
      isbn: '9780000000001',
      titulo: 'Libro de prueba',
      autor: 'Autor de prueba',
      editorial: 'Editorial de prueba',
      portadaUrl: null,
      pvp: 45000,
      porcentajeDescuentoEditorial: 35,
      cantidadTotal: 2,
      estanteId: 'estante-1',
    });
    peticion.flush({ titulo: 'Libro de prueba' });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('catalogado correctamente');
  });

  it('limpia el formulario tras un guardado exitoso', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    enviarFormulario(fixture, datosValidos);
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne('/api/libros').flush({ titulo: 'Libro de prueba' });
    await Promise.resolve();
    await Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formulario = (fixture.componentInstance as any).formulario;
    expect(formulario.value.titulo).toBe('');
    expect(formulario.value.estanteId).toBe('');
    // El porcentaje de descuento editorial se conserva entre libros seguidos.
    expect(formulario.value.porcentajeDescuentoEditorial).toBe(35);
  });

  it('muestra un mensaje de error cuando POST /api/libros falla', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    enviarFormulario(fixture, datosValidos);
    await Promise.resolve();
    await Promise.resolve();
    httpMock
      .expectOne('/api/libros')
      .flush({ error: 'No quedan ejemplares disponibles de este libro.' }, { status: 400, statusText: 'Bad Request' });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No quedan ejemplares disponibles de este libro.');
  });

  it('no envía la petición cuando el formulario es inválido', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    await Promise.resolve();

    httpMock.expectNone('/api/libros');
  });

  it('el botón "Escanear ISBN" activa el escaneo y muestra el video de la cámara', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    const botonEscanear = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Escanear ISBN',
    ) as HTMLButtonElement;
    expect(botonEscanear).toBeTruthy();

    botonEscanear.click();
    await Promise.resolve();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((fixture.componentInstance as any).escaneando()).toBe(true);
    expect(decodeFromConstraintsMock).toHaveBeenCalledTimes(1);

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(video.classList.contains('hidden')).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Detener');
  });

  it('detiene el escaneo y libera la cámara al hacer click en "Detener"', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const componente = fixture.componentInstance as any;
    componente.escaneando.set(true);
    await componente.iniciarEscaneo();
    fixture.detectChanges();

    const botonDetener = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Detener',
    ) as HTMLButtonElement;
    botonDetener.click();
    fixture.detectChanges();

    expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
    expect(componente.escaneando()).toBe(false);
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(video.classList.contains('hidden')).toBe(true);
  });

  it('un resultado simulado del scanner completa el campo isbn y detiene el escaneo', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    const botonEscanear = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Escanear ISBN',
    ) as HTMLButtonElement;
    botonEscanear.click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(callbackDecodificacion).toBeTruthy();
    callbackDecodificacion?.({ getText: () => '9780000000001' });
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const componente = fixture.componentInstance as any;
    expect(componente.formulario.value.isbn).toBe('9780000000001');
    expect(componente.escaneando()).toBe(false);
    expect(detenerEscaneoMock).toHaveBeenCalledTimes(1);
  });

  it('muestra un mensaje de error visible cuando no hay permiso/cámara disponible, sin romper el formulario', async () => {
    decodeFromConstraintsMock.mockRejectedValueOnce(new Error('Permission denied'));
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    const botonEscanear = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Escanear ISBN',
    ) as HTMLButtonElement;
    botonEscanear.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const componente = fixture.componentInstance as any;
    expect(componente.escaneando()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('No se pudo acceder a la cámara');

    // El campo isbn sigue siendo editable manualmente aunque el escaneo falle.
    const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
    campoIsbn.value = '9781234567897';
    campoIsbn.dispatchEvent(new Event('input'));
    expect(componente.formulario.value.isbn).toBe('9781234567897');
  });

  describe('autocompletado de metadatos a partir del ISBN', () => {
    const metadatosEncontrados = {
      titulo: 'Cien años de soledad',
      autor: 'Gabriel García Márquez',
      editorial: 'Sudamericana',
      portadaUrl: 'https://books.google.com/portada.jpg',
    };

    it('un ISBN completado por escaneo dispara la búsqueda y pre-carga los campos vacíos', async () => {
      const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
      httpMock = mock;
      obtenerMetadatosMock.mockResolvedValue(metadatosEncontrados);

      const botonEscanear = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Escanear ISBN',
      ) as HTMLButtonElement;
      botonEscanear.click();
      await Promise.resolve();
      fixture.detectChanges();

      callbackDecodificacion?.({ getText: () => '9780000000001' });
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(obtenerMetadatosMock).toHaveBeenCalledWith('9780000000001');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.titulo).toBe(metadatosEncontrados.titulo);
      expect(componente.formulario.value.autor).toBe(metadatosEncontrados.autor);
      expect(componente.formulario.value.editorial).toBe(metadatosEncontrados.editorial);
      expect(componente.formulario.value.portadaUrl).toBe(metadatosEncontrados.portadaUrl);
    });

    it('un ISBN ingresado manualmente dispara la búsqueda al perder el foco del campo', async () => {
      const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
      httpMock = mock;
      obtenerMetadatosMock.mockResolvedValue(metadatosEncontrados);

      const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
      campoIsbn.value = '9780000000001';
      campoIsbn.dispatchEvent(new Event('input'));
      campoIsbn.dispatchEvent(new Event('blur'));
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(obtenerMetadatosMock).toHaveBeenCalledWith('9780000000001');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.titulo).toBe(metadatosEncontrados.titulo);
    });

    it('no sobrescribe un campo que el vendedor ya completó a mano', async () => {
      const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
      httpMock = mock;
      obtenerMetadatosMock.mockResolvedValue(metadatosEncontrados);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.formulario.controls.titulo.setValue('Título escrito a mano');

      const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
      campoIsbn.value = '9780000000001';
      campoIsbn.dispatchEvent(new Event('input'));
      campoIsbn.dispatchEvent(new Event('blur'));
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(componente.formulario.value.titulo).toBe('Título escrito a mano');
      // Los campos que sí estaban vacíos igual se pre-cargan.
      expect(componente.formulario.value.autor).toBe(metadatosEncontrados.autor);
    });

    it('un fallo de la búsqueda de metadatos no bloquea la edición manual del formulario', async () => {
      const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
      httpMock = mock;
      obtenerMetadatosMock.mockResolvedValue(metadatosVacios);

      const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
      campoIsbn.value = '0000000000000';
      campoIsbn.dispatchEvent(new Event('input'));
      campoIsbn.dispatchEvent(new Event('blur'));
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No se encontraron datos');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.formulario.controls.titulo.setValue('Escrito manualmente tras el fallo');
      expect(componente.formulario.value.titulo).toBe('Escrito manualmente tras el fallo');
    });
  });
});
