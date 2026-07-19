import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { EstantesService } from '../../core/api/estantes.service';
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

function configurarPrueba() {
  const cargarEstantesMock = vi.fn().mockResolvedValue(undefined);
  const obtenerIdTokenMock = vi.fn().mockResolvedValue('token-valido');

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
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture: ComponentFixture<CatalogarLibroComponent> = TestBed.createComponent(CatalogarLibroComponent);
  fixture.detectChanges();

  return { fixture, httpMock, obtenerIdTokenMock, cargarEstantesMock };
}

function enviarFormulario(fixture: ComponentFixture<CatalogarLibroComponent>, datos: typeof datosValidos): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(datos);
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

describe('CatalogarLibroComponent', () => {
  let httpMock: HttpTestingController;

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
});
