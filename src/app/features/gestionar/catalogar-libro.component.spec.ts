import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { EditorialesDescuentosService } from '../../core/api/editoriales-descuentos.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { MetadatosService } from '../../core/api/metadatos.service';
import type { DescuentoEditorial } from '../../core/models/descuento-editorial.model';
import type { Espacio } from '../../core/models/espacio.model';
import type { Mueble } from '../../core/models/mueble.model';
import type { Ubicacion } from '../../core/models/ubicacion.model';
import type { LibroConUbicacion } from '../../core/models/libro.model';
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

const espacioFalso: Espacio = { espacioId: 'espacio-1', nombre: 'Sala principal' };
const muebleFalso: Mueble = { muebleId: 'mueble-1', espacioId: 'espacio-1', nombre: 'Biblioteca 1' };
const ubicacionFalsa: Ubicacion = {
  ubicacionId: 'ubicacion-1',
  muebleId: 'mueble-1',
  nombre: 'Estante 1',
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
};

const metadatosVacios = { titulo: null, autor: null, editorial: null, portadaUrl: null, pvp: null };

function configurarPrueba(descuentos: DescuentoEditorial[] = []) {
  const cargarEspaciosMock = vi.fn().mockResolvedValue(undefined);
  const cargarMueblesMock = vi.fn().mockResolvedValue(undefined);
  const cargarUbicacionesMock = vi.fn().mockResolvedValue(undefined);
  const cargarDescuentosMock = vi.fn().mockResolvedValue(undefined);
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
  // Por defecto no encuentra portadas — las pruebas del selector manual de
  // portada sobrescriben esta resolución.
  const buscarPortadasMock = vi.fn().mockResolvedValue([]);

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { obtenerIdToken: obtenerIdTokenMock } },
      {
        provide: UbicacionFisicaService,
        useValue: {
          espacios: signal([espacioFalso]),
          errorEspacios: signal(false),
          cargarEspacios: cargarEspaciosMock,
          muebles: signal([muebleFalso]),
          cargarMuebles: cargarMueblesMock,
          ubicaciones: signal([ubicacionFalsa]),
          errorUbicaciones: signal(false),
          cargarUbicaciones: cargarUbicacionesMock,
        },
      },
      {
        provide: MetadatosService,
        useValue: {
          obtenerMetadatos: obtenerMetadatosMock,
          buscarCandidatos: buscarCandidatosMock,
          buscarPvp: buscarPvpMock,
          buscarPortadas: buscarPortadasMock,
        },
      },
      {
        provide: EditorialesDescuentosService,
        useValue: {
          descuentos: signal(descuentos),
          cargarDescuentos: cargarDescuentosMock,
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
    cargarEspaciosMock,
    cargarMueblesMock,
    cargarUbicacionesMock,
    cargarDescuentosMock,
    obtenerMetadatosMock,
    buscarCandidatosMock,
    buscarPvpMock,
    buscarPortadasMock,
  };
}

/** Selecciona la ubicación del panel directamente en el componente (fuera del `FormGroup` reactivo) antes de enviar el formulario. */
function seleccionarUbicacionPanel(fixture: ComponentFixture<CatalogarLibroComponent>, ubicacionId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).panelUbicacionId.set(ubicacionId);
}

function enviarFormulario(fixture: ComponentFixture<CatalogarLibroComponent>, datos: typeof datosValidos): void {
  seleccionarUbicacionPanel(fixture, 'ubicacion-1');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(datos);
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

/** Deja pasar varios ticks de microtareas — necesario para que las cadenas `await` encadenadas (`dispararBusquedaPorIsbn`: metadatos externos → duplicados por ISBN) terminen de registrar su petición HTTP en `HttpTestingController` antes de `expectOne`. */
async function dejarPasarMicrotareas(veces = 5): Promise<void> {
  for (let i = 0; i < veces; i++) {
    await Promise.resolve();
  }
}

/**
 * Responde `GET /api/libros/por-isbn/:isbn` (detección de duplicados,
 * `TODO.md` Tarea 2.3) — se dispara SIEMPRE después de
 * `buscarYPrecargarMetadatos` en los mismos 3 puntos (escaneo, blur del ISBN
 * manual, selección de un candidato con ISBN), así que cualquier prueba que
 * complete uno de esos 3 flujos debe drenarla, o `HttpTestingController`
 * queda con una petición pendiente sin resolver. Por defecto responde `[]`
 * (sin duplicados) para no alterar las aserciones de pruebas que no están
 * probando el flujo de duplicados.
 */
async function flushBusquedaDuplicados(
  httpMock: HttpTestingController,
  isbn: string,
  coincidencias: LibroConUbicacion[] = [],
): Promise<void> {
  await dejarPasarMicrotareas();
  httpMock.expectOne(`/api/libros/por-isbn/${isbn}`).flush(coincidencias);
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

  it('carga espacios, muebles, ubicaciones y descuentos editoriales al inicializar', () => {
    const resultado = configurarPrueba();
    httpMock = resultado.httpMock;

    expect(resultado.cargarEspaciosMock).toHaveBeenCalledTimes(1);
    expect(resultado.cargarMueblesMock).toHaveBeenCalledTimes(1);
    expect(resultado.cargarUbicacionesMock).toHaveBeenCalledTimes(1);
    expect(resultado.cargarDescuentosMock).toHaveBeenCalledTimes(1);
  });

  it('no envía la petición y muestra un mensaje cuando el formulario es válido pero no se eligió ubicación', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fixture.componentInstance as any).formulario.setValue(datosValidos);
    const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    await Promise.resolve();
    fixture.detectChanges();

    httpMock.expectNone('/api/libros');
    expect(fixture.nativeElement.textContent).toContain('Selecciona la ubicación del libro');
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
      ubicacionId: 'ubicacion-1',
    });
    peticion.flush({ titulo: 'Libro de prueba' });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('catalogado correctamente');
  });

  it('limpia el formulario tras un guardado exitoso, pero conserva la ubicación del panel', async () => {
    const { fixture, httpMock: mock } = configurarPrueba();
    httpMock = mock;

    enviarFormulario(fixture, datosValidos);
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne('/api/libros').flush({ titulo: 'Libro de prueba' });
    await Promise.resolve();
    await Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const componente = fixture.componentInstance as any;
    expect(componente.formulario.value.titulo).toBe('');
    // El porcentaje de descuento editorial se conserva entre libros seguidos.
    expect(componente.formulario.value.porcentajeDescuentoEditorial).toBe(35);
    // El panel "Ubicación del libro" NUNCA se limpia — persiste entre catalogaciones seguidas.
    expect(componente.panelUbicacionId()).toBe('ubicacion-1');
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

    await flushBusquedaDuplicados(httpMock, '9780000000001');
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

      await flushBusquedaDuplicados(httpMock, '9780000000001');
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

      await flushBusquedaDuplicados(httpMock, '9780000000001');
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

      await flushBusquedaDuplicados(httpMock, '9780000000001');
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

      await flushBusquedaDuplicados(httpMock, '9780000000001');
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

      await flushBusquedaDuplicados(httpMock, '9780000000001');
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

      await flushBusquedaDuplicados(httpMock, '0000000000000');
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

      await flushBusquedaDuplicados(httpMock, '9780307474728');
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

      await flushBusquedaDuplicados(httpMock, '9780307474728');
    });
  });

  describe('detección de libros ya catalogados por ISBN (TODO.md Tarea 2.3)', () => {
    /** `espacioFalso`/`muebleFalso`/`ubicacionFalsa` (fixtures del módulo) resuelven la cadena Espacio/Mueble/Ubicación de este duplicado. */
    const libroDuplicadoFalso: LibroConUbicacion = {
      isbn: '9780000000001',
      bookId: 'libro-duplicado-1',
      titulo: 'Libro ya catalogado',
      autor: 'Autor ya catalogado',
      editorial: 'Editorial ya catalogada',
      portadaUrl: 'https://books.google.com/portada-duplicado.jpg',
      pvp: 60000,
      porcentajeDescuentoEditorial: 30,
      costo: 42000,
      utilidadCatalogo: 18000,
      cantidadTotal: 3,
      cantidadDisponible: 2,
      ubicacionId: 'ubicacion-1',
      creadoPor: 'vendedor@letiende.co',
      creadoEn: '2026-01-01T00:00:00.000Z',
      actualizadoEn: '2026-01-01T00:00:00.000Z',
      ubicacion: { espacio: espacioFalso.nombre, mueble: muebleFalso.nombre, ubicacion: ubicacionFalsa.nombre },
    };

    function blurIsbn(fixture: ComponentFixture<CatalogarLibroComponent>, isbn: string): void {
      const campoIsbn = fixture.nativeElement.querySelector('#isbn') as HTMLInputElement;
      campoIsbn.value = isbn;
      campoIsbn.dispatchEvent(new Event('input'));
      campoIsbn.dispatchEvent(new Event('blur'));
    }

    it('sin coincidencias no cambia nada respecto al flujo normal', async () => {
      const { fixture, httpMock: mock } = configurarPrueba();
      httpMock = mock;

      blurIsbn(fixture, '9780000000001');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      await flushBusquedaDuplicados(httpMock, '9780000000001', []);
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.libroDuplicadoSeleccionado()).toBeNull();
      expect(componente.coincidenciasIsbn()).toEqual([]);
      expect(fixture.nativeElement.textContent).not.toContain('ya está catalogado');
    });

    it('con 1 coincidencia precarga el formulario completo y el panel de ubicación', async () => {
      const { fixture, httpMock: mock } = configurarPrueba();
      httpMock = mock;

      blurIsbn(fixture, '9780000000001');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      await flushBusquedaDuplicados(httpMock, '9780000000001', [libroDuplicadoFalso]);
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.libroDuplicadoSeleccionado()).toEqual(libroDuplicadoFalso);
      expect(componente.formulario.value.titulo).toBe(libroDuplicadoFalso.titulo);
      expect(componente.formulario.value.autor).toBe(libroDuplicadoFalso.autor);
      expect(componente.formulario.value.editorial).toBe(libroDuplicadoFalso.editorial);
      expect(componente.formulario.value.portadaUrl).toBe(libroDuplicadoFalso.portadaUrl);
      expect(componente.formulario.value.pvp).toBe(libroDuplicadoFalso.pvp);
      expect(componente.formulario.value.porcentajeDescuentoEditorial).toBe(
        libroDuplicadoFalso.porcentajeDescuentoEditorial,
      );
      // `cantidadTotal` se resetea a 1 — a partir de aquí representa "ejemplares nuevos", no el total existente.
      expect(componente.formulario.value.cantidadTotal).toBe(1);
      expect(componente.panelEspacioId()).toBe('espacio-1');
      expect(componente.panelMuebleId()).toBe('mueble-1');
      expect(componente.panelUbicacionId()).toBe('ubicacion-1');

      expect(fixture.nativeElement.textContent).toContain('Este libro ya está catalogado');
      expect(fixture.nativeElement.textContent).toContain('2 disponibles');
    });

    it('con varias coincidencias se puede elegir una de la lista', async () => {
      const { fixture, httpMock: mock } = configurarPrueba();
      httpMock = mock;
      const segundoDuplicado: LibroConUbicacion = {
        ...libroDuplicadoFalso,
        bookId: 'libro-duplicado-2',
        titulo: 'Otro libro ya catalogado',
      };

      blurIsbn(fixture, '9780000000001');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      await flushBusquedaDuplicados(httpMock, '9780000000001', [libroDuplicadoFalso, segundoDuplicado]);
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.coincidenciasIsbn().length).toBe(2);
      expect(componente.libroDuplicadoSeleccionado()).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Otro libro ya catalogado');

      const botones = Array.from(fixture.nativeElement.querySelectorAll('ul button')) as HTMLButtonElement[];
      const botonSegundo = botones.find((boton) => boton.textContent?.includes('Otro libro ya catalogado'));
      expect(botonSegundo).toBeTruthy();
      botonSegundo?.click();
      fixture.detectChanges();

      expect(componente.libroDuplicadoSeleccionado()?.bookId).toBe('libro-duplicado-2');
      expect(componente.coincidenciasIsbn()).toEqual([]);
      expect(componente.formulario.value.titulo).toBe('Otro libro ya catalogado');
    });

    it('"Ignorar y catalogar como nuevo" descarta el duplicado sin perder lo ya escrito', async () => {
      const { fixture, httpMock: mock } = configurarPrueba();
      httpMock = mock;

      blurIsbn(fixture, '9780000000001');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      await flushBusquedaDuplicados(httpMock, '9780000000001', [libroDuplicadoFalso]);
      fixture.detectChanges();

      const botonIgnorar = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Ignorar y catalogar como nuevo',
      ) as HTMLButtonElement;
      expect(botonIgnorar).toBeTruthy();
      botonIgnorar.click();
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.libroDuplicadoSeleccionado()).toBeNull();
      // El título precargado por el duplicado se conserva — solo se descarta el estado de duplicado.
      expect(componente.formulario.value.titulo).toBe(libroDuplicadoFalso.titulo);
      expect(fixture.nativeElement.textContent).not.toContain('ya está catalogado');
    });

    it('al guardar con un duplicado seleccionado llama POST fusionar-duplicado con el DELTA, no PUT ni un total absoluto', async () => {
      const { fixture, httpMock: mock } = configurarPrueba();
      httpMock = mock;

      blurIsbn(fixture, '9780000000001');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      await flushBusquedaDuplicados(httpMock, '9780000000001', [libroDuplicadoFalso]);
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.formulario.controls.cantidadTotal.setValue(2);

      const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      formulario.dispatchEvent(new Event('submit'));
      await Promise.resolve();
      await Promise.resolve();

      // Endpoint dedicado de fusión atómica — nunca `PUT /api/libros/:bookId`
      // (que exigiría calcular un total absoluto en el cliente, la condición
      // de carrera corregida en MEMORY.md).
      const peticion = httpMock.expectOne(`/api/libros/${libroDuplicadoFalso.bookId}/fusionar-duplicado`);
      expect(peticion.request.method).toBe('POST');
      expect(peticion.request.body).toEqual({
        isbn: '9780000000001',
        titulo: libroDuplicadoFalso.titulo,
        autor: libroDuplicadoFalso.autor,
        editorial: libroDuplicadoFalso.editorial,
        portadaUrl: libroDuplicadoFalso.portadaUrl,
        pvp: libroDuplicadoFalso.pvp,
        porcentajeDescuentoEditorial: libroDuplicadoFalso.porcentajeDescuentoEditorial,
        ubicacionId: 'ubicacion-1',
        // El DELTA tal cual lo escribió el vendedor (2) — NUNCA
        // "cantidadTotal existente + nuevo" calculado en el cliente.
        ejemplaresNuevos: 2,
      });
      peticion.flush({ titulo: libroDuplicadoFalso.titulo });
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('actualizado');
      expect(fixture.nativeElement.textContent).toContain('se agregaron 2 ejemplares nuevos');
      httpMock.expectNone('/api/libros');
    });

    it(
      'cambiar el ISBN resetea el duplicado seleccionado de forma SÍNCRONA, sin esperar a que termine la ' +
        'búsqueda de metadatos (corrección de condición de carrera, MEMORY.md)',
      async () => {
        const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
        httpMock = mock;

        // Primero selecciona un duplicado con el ISBN original.
        blurIsbn(fixture, '9780000000001');
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
        await flushBusquedaDuplicados(httpMock, '9780000000001', [libroDuplicadoFalso]);
        fixture.detectChanges();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const componente = fixture.componentInstance as any;
        expect(componente.libroDuplicadoSeleccionado()).toEqual(libroDuplicadoFalso);

        // Ahora cambia el ISBN — congela `buscarYPrecargarMetadatos` a mitad
        // de camino (promesa deliberadamente sin resolver) para simular la
        // ventana de espera donde vivía el bug: si el reset dependiera de que
        // esa búsqueda termine primero, `libroDuplicadoSeleccionado` seguiría
        // apuntando al duplicado viejo mientras esta promesa está pendiente.
        let resolverMetadatos: (() => void) | undefined;
        obtenerMetadatosMock.mockReturnValue(
          new Promise((resolve) => {
            resolverMetadatos = () => resolve(metadatosVacios);
          }),
        );

        blurIsbn(fixture, '9780000000099');

        // CERO `await` todavía: el reset debe ser síncrono, no depender de
        // que `buscarYPrecargarMetadatos` (todavía congelada) resuelva.
        expect(componente.libroDuplicadoSeleccionado()).toBeNull();
        expect(componente.coincidenciasIsbn()).toEqual([]);

        // Limpieza: libera la promesa congelada y drena la búsqueda de
        // duplicados resultante para no dejar una petición HTTP pendiente.
        resolverMetadatos?.();
        await flushBusquedaDuplicados(httpMock, '9780000000099', []);
      },
    );

    it(
      'el botón "Catalogar libro" se deshabilita mientras se buscan metadatos o duplicados por ISBN, no solo ' +
        'mientras se guarda',
      async () => {
        const { fixture, httpMock: mock, obtenerMetadatosMock } = configurarPrueba();
        httpMock = mock;

        const botonGuardar = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
        expect(botonGuardar.disabled).toBe(false);

        // Congela `buscarYPrecargarMetadatos` para inspeccionar el botón
        // mientras `buscandoMetadatos()` sigue en `true`.
        let resolverMetadatos: (() => void) | undefined;
        obtenerMetadatosMock.mockReturnValue(
          new Promise((resolve) => {
            resolverMetadatos = () => resolve(metadatosVacios);
          }),
        );

        blurIsbn(fixture, '9780000000001');
        await Promise.resolve();
        fixture.detectChanges();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const componente = fixture.componentInstance as any;
        expect(componente.buscandoMetadatos()).toBe(true);
        expect(botonGuardar.disabled).toBe(true);

        resolverMetadatos?.();
        // Varios ticks de microtareas: `buscarYPrecargarMetadatos` debe
        // terminar Y `buscarDuplicadosPorIsbn` debe avanzar hasta fijar
        // `buscandoDuplicados(true)` (justo antes de quedar suspendida en el
        // `await this.http.get(...)`) — mismo criterio que
        // `dejarPasarMicrotareas`/`flushBusquedaDuplicados` usan en otras
        // pruebas de este archivo. `detectChanges()` se llama DESPUÉS de
        // estos ticks (no antes) para que el DOM ya refleje el nuevo valor
        // del signal cuando se lee `botonGuardar.disabled`.
        await dejarPasarMicrotareas();
        fixture.detectChanges();

        // `buscarYPrecargarMetadatos` ya terminó, pero `buscarDuplicadosPorIsbn`
        // (la siguiente etapa de `dispararBusquedaPorIsbn`) sigue en curso —
        // el botón debe seguir deshabilitado mientras `buscandoDuplicados()` sea `true`.
        expect(componente.buscandoMetadatos()).toBe(false);
        expect(componente.buscandoDuplicados()).toBe(true);
        expect(botonGuardar.disabled).toBe(true);

        await flushBusquedaDuplicados(httpMock, '9780000000001', []);
        fixture.detectChanges();

        expect(componente.buscandoDuplicados()).toBe(false);
        expect(botonGuardar.disabled).toBe(false);
      },
    );
  });

  describe('panel "Ubicación del libro" (cascada Espacio → Mueble → Ubicación)', () => {
    it('el select de Mueble solo lista los muebles del espacio elegido', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.panelEspacioId.set('espacio-1');
      expect(componente.panelMueblesDelEspacio()).toEqual([muebleFalso]);

      componente.panelEspacioId.set('espacio-inexistente');
      expect(componente.panelMueblesDelEspacio()).toEqual([]);
    });

    it('el select de Ubicación solo lista las ubicaciones del mueble elegido', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      componente.panelMuebleId.set('mueble-1');
      expect(componente.panelUbicacionesDelMueble()).toEqual([ubicacionFalsa]);

      componente.panelMuebleId.set('mueble-inexistente');
      expect(componente.panelUbicacionesDelMueble()).toEqual([]);
    });

    it('cambiar el Espacio limpia la selección de Mueble y Ubicación', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.panelMuebleId.set('mueble-1');
      componente.panelUbicacionId.set('ubicacion-1');

      componente.alCambiarPanelEspacio();

      expect(componente.panelMuebleId()).toBe('');
      expect(componente.panelUbicacionId()).toBe('');
    });

    it('cambiar el Mueble limpia la selección de Ubicación', () => {
      const { fixture } = configurarPrueba();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      componente.panelUbicacionId.set('ubicacion-1');

      componente.alCambiarPanelMueble();

      expect(componente.panelUbicacionId()).toBe('');
    });

    it('el panel persiste tras un guardado exitoso, aunque el resto del formulario se limpie', async () => {
      const { fixture, httpMock: mock } = configurarPrueba();
      httpMock = mock;

      enviarFormulario(fixture, datosValidos);
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/libros').flush({ titulo: 'Libro de prueba' });
      await Promise.resolve();
      await Promise.resolve();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      expect(componente.panelUbicacionId()).toBe('ubicacion-1');
    });
  });

  describe('autocompletado de porcentajeDescuentoEditorial', () => {
    const descuentoSudamericana: DescuentoEditorial = {
      editorial: 'Sudamericana',
      porcentajePorDefecto: 40,
      porcentajesDisponibles: [40],
    };

    it('autocompleta el porcentaje al perder el foco de Editorial cuando coincide (insensible a mayúsculas/tildes)', async () => {
      const { fixture } = configurarPrueba([descuentoSudamericana]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      const campoEditorial = fixture.nativeElement.querySelector('#editorial') as HTMLInputElement;
      campoEditorial.value = 'sudaméricana';
      campoEditorial.dispatchEvent(new Event('input'));
      campoEditorial.dispatchEvent(new Event('blur'));

      expect(componente.formulario.value.porcentajeDescuentoEditorial).toBe(40);
    });

    it('no autocompleta cuando ninguna editorial configurada coincide', async () => {
      const { fixture } = configurarPrueba([descuentoSudamericana]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      const campoEditorial = fixture.nativeElement.querySelector('#editorial') as HTMLInputElement;
      campoEditorial.value = 'Editorial sin configurar';
      campoEditorial.dispatchEvent(new Event('input'));
      campoEditorial.dispatchEvent(new Event('blur'));

      expect(componente.formulario.value.porcentajeDescuentoEditorial).toBe(35);
    });

    it('no pisa el porcentaje si el vendedor ya lo modificó a mano antes de que la editorial coincida', async () => {
      const { fixture } = configurarPrueba([descuentoSudamericana]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      const campoDescuento = fixture.nativeElement.querySelector(
        '#porcentajeDescuentoEditorial',
      ) as HTMLInputElement;
      campoDescuento.value = '20';
      campoDescuento.dispatchEvent(new Event('input'));

      const campoEditorial = fixture.nativeElement.querySelector('#editorial') as HTMLInputElement;
      campoEditorial.value = 'Sudamericana';
      campoEditorial.dispatchEvent(new Event('input'));
      campoEditorial.dispatchEvent(new Event('blur'));

      expect(componente.formulario.value.porcentajeDescuentoEditorial).toBe(20);
    });

    it('vuelve a autocompletar en la siguiente catalogación tras un guardado exitoso', async () => {
      const { fixture, httpMock: mock } = configurarPrueba([descuentoSudamericana]);
      httpMock = mock;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;

      // El vendedor modifica el descuento a mano para este primer libro.
      componente.marcarDescuentoTocadoManualmente();
      enviarFormulario(fixture, datosValidos);
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/libros').flush({ titulo: 'Libro de prueba' });
      await Promise.resolve();
      await Promise.resolve();

      // Libro siguiente: el autocompletado debe volver a funcionar.
      const campoEditorial = fixture.nativeElement.querySelector('#editorial') as HTMLInputElement;
      campoEditorial.value = 'Sudamericana';
      campoEditorial.dispatchEvent(new Event('input'));
      campoEditorial.dispatchEvent(new Event('blur'));

      expect(componente.formulario.value.porcentajeDescuentoEditorial).toBe(40);
    });
  });

  describe('selector manual de portada', () => {
    function botonActualizarPortada(fixture: ComponentFixture<CatalogarLibroComponent>): HTMLButtonElement | null {
      return fixture.nativeElement.querySelector('button[aria-label="Buscar otra portada"]');
    }

    /** Simula lo que hace un vendedor de verdad: escribir en el campo y disparar `input`, no mutar el FormControl a mano — mismo patrón que el resto del archivo (ej. `campoIsbn.dispatchEvent(new Event('input'))`). */
    function escribirEnCampo(fixture: ComponentFixture<CatalogarLibroComponent>, id: string, valor: string): void {
      const campo = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('el botón de actualizar portada no aparece sin una portada ya cargada', () => {
      const { fixture } = configurarPrueba();

      expect(botonActualizarPortada(fixture)).toBeNull();
    });

    it('el botón está deshabilitado sin ISBN, habilitado con ISBN presente', () => {
      const { fixture } = configurarPrueba();

      escribirEnCampo(fixture, 'portadaUrl', 'https://ejemplo.com/portada.jpg');

      expect(botonActualizarPortada(fixture)?.disabled).toBe(true);

      escribirEnCampo(fixture, 'isbn', '9780000000001');

      expect(botonActualizarPortada(fixture)?.disabled).toBe(false);
    });

    it('clic en el botón abre el selector, que busca portadas con el isbn actual', async () => {
      const { fixture, buscarPortadasMock } = configurarPrueba();
      escribirEnCampo(fixture, 'isbn', '9780000000001');
      escribirEnCampo(fixture, 'portadaUrl', 'https://ejemplo.com/portada.jpg');

      botonActualizarPortada(fixture)?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(buscarPortadasMock).toHaveBeenCalledWith('9780000000001');
      expect(fixture.nativeElement.textContent).toContain('Elegir portada');
    });

    it('seleccionar una portada en el diálogo actualiza portadaUrl y lo cierra', async () => {
      const { fixture, buscarPortadasMock } = configurarPrueba();
      buscarPortadasMock.mockResolvedValue([
        { dominio: 'www.librerialerner.com.co', nombre: 'Librería Lerner', portadaUrl: 'https://lerner.com/nueva.jpg' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const componente = fixture.componentInstance as any;
      escribirEnCampo(fixture, 'isbn', '9780000000001');
      escribirEnCampo(fixture, 'portadaUrl', 'https://ejemplo.com/portada-vieja.jpg');

      botonActualizarPortada(fixture)?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const tarjeta = Array.from(fixture.nativeElement.querySelectorAll('button')).find((boton) =>
        (boton as HTMLElement).textContent?.includes('Librería Lerner'),
      ) as HTMLButtonElement;
      tarjeta.click();
      fixture.detectChanges();

      const botonCambiar = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLElement).textContent?.trim() === 'Cambiar',
      ) as HTMLButtonElement;
      botonCambiar.click();
      fixture.detectChanges();

      expect(componente.formulario.value.portadaUrl).toBe('https://lerner.com/nueva.jpg');
      expect(componente.selectorPortadaVisible()).toBe(false);
    });
  });
});
