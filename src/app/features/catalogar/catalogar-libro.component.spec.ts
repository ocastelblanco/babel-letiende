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

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null, pvp: null };

function configurarPrueba() {
  const cargarEstantesMock = vi.fn().mockResolvedValue(undefined);
  const obtenerIdTokenMock = vi.fn().mockResolvedValue('token-valido');
  // Por defecto no encuentra nada — las pruebas de autocompletado sobrescriben
  // esta resolución con `mockResolvedValueOnce`/`mockResolvedValue` según el caso.
  const obtenerMetadatosMock = vi.fn().mockResolvedValue(metadatosVacios);
  // Por defecto no encuentra candidatos — las pruebas de búsqueda por
  // título/autor sobrescriben esta resolución.
  const buscarCandidatosMock = vi.fn().mockResolvedValue([]);
  // Por defecto no encuentra precio — las pruebas de PVP de un candidato sin
  // ISBN sobrescriben esta resolución.
  const buscarPvpMock = vi.fn().mockResolvedValue(null);

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
      {
        provide: MetadatosService,
        useValue: {
          obtenerMetadatos: obtenerMetadatosMock,
          buscarCandidatos: buscarCandidatosMock,
          buscarPvp: buscarPvpMock,
        },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture: ComponentFixture<CatalogarLibroComponent> = TestBed.createComponent(CatalogarLibroComponent);
  fixture.detectChanges();

  return {
    fixture,
    httpMock,
    obtenerIdTokenMock,
    cargarEstantesMock,
    obtenerMetadatosMock,
    buscarCandidatosMock,
    buscarPvpMock,
  };
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
      pvp: 65_000,
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
      expect(componente.formulario.value.pvp).toBe(metadatosEncontrados.pvp);
    });

    it('pre-carga el pvp cuando el campo está en su valor por defecto (0)', async () => {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.pvp).toBe(metadatosEncontrados.pvp);
    });

    it('no sobrescribe un pvp que el vendedor ya escribió a mano', async () => {
      const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
      httpMock = mock;
      obtenerMetadatosMock.mockResolvedValue(metadatosEncontrados);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.formulario.controls.pvp.setValue(99_000);

      const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
      campoIsbn.value = '9780000000001';
      campoIsbn.dispatchEvent(new Event('input'));
      campoIsbn.dispatchEvent(new Event('blur'));
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(componente.formulario.value.pvp).toBe(99_000);
      // Los demás campos que sí estaban vacíos igual se pre-cargan.
      expect(componente.formulario.value.titulo).toBe(metadatosEncontrados.titulo);
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

  describe('búsqueda de candidatos por título/autor (sin ISBN)', () => {
    const candidatoConIsbn = {
      titulo: 'Cien años de soledad',
      autor: 'Gabriel García Márquez',
      editorial: 'Sudamericana',
      portadaUrl: 'https://books.google.com/portada.jpg',
      isbn: '9780307474728',
    };
    const candidatoSinIsbn = {
      titulo: 'Otro libro',
      autor: null,
      editorial: null,
      portadaUrl: null,
      isbn: null,
    };

    function botonBuscarCandidatos(fixture: ComponentFixture<CatalogarLibroComponent>): HTMLButtonElement {
      return Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Buscar por título y autor',
      ) as HTMLButtonElement;
    }

    it('el botón "Buscar por título y autor" solo aparece cuando el ISBN está vacío', async () => {
      const { fixture } = configurarPrueba();

      expect(botonBuscarCandidatos(fixture)).toBeTruthy();

      const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
      campoIsbn.value = '9780000000001';
      campoIsbn.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(botonBuscarCandidatos(fixture)).toBeFalsy();
    });

    it('el botón está deshabilitado sin título ni autor escritos', () => {
      const { fixture } = configurarPrueba();
      expect(botonBuscarCandidatos(fixture).disabled).toBe(true);
    });

    it('busca candidatos y los muestra (portada + título + autor + editorial + isbn) al hacer click', async () => {
      const { fixture, buscarCandidatosMock } = configurarPrueba();
      buscarCandidatosMock.mockResolvedValue([candidatoConIsbn, candidatoSinIsbn]);

      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'cien años de soledad';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(buscarCandidatosMock).toHaveBeenCalledWith('cien años de soledad', '');
      expect(fixture.nativeElement.textContent).toContain('Cien años de soledad');
      expect(fixture.nativeElement.textContent).toContain('Gabriel García Márquez');
      expect(fixture.nativeElement.textContent).toContain('Sudamericana');
      expect(fixture.nativeElement.textContent).toContain('9780307474728');
      expect(fixture.nativeElement.textContent).toContain('Otro libro');
      const imagenes = fixture.nativeElement.querySelectorAll('img[src="https://books.google.com/portada.jpg"]');
      expect(imagenes.length).toBe(1);
    });

    it('muestra un mensaje neutral cuando la búsqueda no encuentra candidatos', async () => {
      const { fixture, buscarCandidatosMock } = configurarPrueba();
      buscarCandidatosMock.mockResolvedValue([]);

      const campoAutor = fixture.nativeElement.querySelector('#autor') as HTMLInputElement;
      campoAutor.value = 'autor sin resultados';
      campoAutor.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No se encontraron candidatos');
    });

    it('seleccionar un candidato SIN isbn pre-carga los campos y busca el pvp por título/autor (sin resultado → 0)', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock, obtenerMetadatosMock, buscarPvpMock } =
        configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoSinIsbn]);
      buscarPvpMock.mockResolvedValue(null);

      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'otro libro';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(buscarPvpMock).toHaveBeenCalledWith('Otro libro', '');
      expect(obtenerMetadatosMock).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.isbn).toBe('');
      expect(componente.formulario.value.pvp).toBe(0);
      // La lista de candidatos se cierra tras seleccionar uno.
      expect(fixture.nativeElement.querySelectorAll('ul button').length).toBe(0);
    });

    it('seleccionar un candidato SIN isbn completa el pvp cuando la búsqueda por título/autor sí encuentra precio', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock, buscarPvpMock } = configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoSinIsbn]);
      buscarPvpMock.mockResolvedValue(58_000);

      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'otro libro';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.pvp).toBe(58_000);
    });

    it('sobrescribe un pvp que el vendedor ya había escrito a mano al seleccionar un candidato sin isbn', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock, buscarPvpMock } = configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoSinIsbn]);
      buscarPvpMock.mockResolvedValue(58_000);

      const campoPvp = fixture.nativeElement.querySelector('#pvp') as HTMLInputElement;
      campoPvp.value = '40000';
      campoPvp.dispatchEvent(new Event('input'));
      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'otro libro';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(buscarPvpMock).toHaveBeenCalledWith('Otro libro', '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.pvp).toBe(58_000);
    });

    it('deja el pvp como estaba cuando la búsqueda por título/autor no encuentra precio', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock, buscarPvpMock } = configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoSinIsbn]);
      buscarPvpMock.mockResolvedValue(null);

      const campoPvp = fixture.nativeElement.querySelector('#pvp') as HTMLInputElement;
      campoPvp.value = '40000';
      campoPvp.dispatchEvent(new Event('input'));
      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'otro libro';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.pvp).toBe(40000);
    });

    it('seleccionar un candidato CON isbn completa el campo isbn y dispara el autocompletado de pvp existente', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock, obtenerMetadatosMock, buscarPvpMock } =
        configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoConIsbn]);
      obtenerMetadatosMock.mockResolvedValue({
        titulo: 'Cien años de soledad',
        autor: 'Gabriel García Márquez',
        editorial: 'Sudamericana',
        portadaUrl: 'https://books.google.com/portada.jpg',
        pvp: 65_000,
      });

      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'cien años de soledad';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(obtenerMetadatosMock).toHaveBeenCalledWith('9780307474728');
      expect(buscarPvpMock).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.formulario.value.isbn).toBe('9780307474728');
      expect(componente.formulario.value.pvp).toBe(65_000);
    });

    it('sobrescribe campos que el vendedor ya había completado a mano al elegir un candidato (selección explícita)', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock } = configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoSinIsbn]);

      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'otro libro';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.formulario.controls.editorial.setValue('Editorial escrita a mano');
      componente.formulario.controls.autor.setValue('Autor escrito a mano');

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      // `candidatoSinIsbn` no trae autor/editorial (ver fixture arriba) — al
      // no haber dato nuevo que ofrecer, lo ya escrito a mano se conserva.
      expect(componente.formulario.value.editorial).toBe('Editorial escrita a mano');
      expect(componente.formulario.value.autor).toBe('Autor escrito a mano');
      expect(componente.formulario.value.titulo).toBe('Otro libro');
    });

    it('sobrescribe título/autor/editorial ya escritos a mano cuando el candidato SÍ trae esos datos', async () => {
      const { fixture, httpMock: mock, buscarCandidatosMock } = configurarPrueba();
      httpMock = mock;
      buscarCandidatosMock.mockResolvedValue([candidatoConIsbn]);

      const campoTitulo = fixture.nativeElement.querySelector('#titulo') as HTMLInputElement;
      campoTitulo.value = 'cien años de soledad';
      campoTitulo.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.formulario.controls.autor.setValue('Autor escrito a mano');
      componente.formulario.controls.editorial.setValue('Editorial escrita a mano');

      botonBuscarCandidatos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const botonCandidato = fixture.nativeElement.querySelector('ul button') as HTMLButtonElement;
      botonCandidato.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      // `candidatoConIsbn` trae autor/editorial (ver fixture arriba) — se
      // sobrescribe lo ya escrito a mano, es una selección explícita.
      expect(componente.formulario.value.autor).toBe('Gabriel García Márquez');
      expect(componente.formulario.value.editorial).toBe('Sudamericana');
    });
  });
});
