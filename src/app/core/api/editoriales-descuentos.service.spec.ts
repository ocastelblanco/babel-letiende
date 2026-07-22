import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { DescuentoEditorial } from '../models/descuento-editorial.model';
import { EditorialesDescuentosService } from './editoriales-descuentos.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo. Se mockea aquí también (igual que en
// `usuarios.service.spec.ts`) para que este archivo nunca cargue el
// `firebase/auth` real.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

describe('EditorialesDescuentosService', () => {
  let httpMock: HttpTestingController;
  let obtenerIdTokenMock: ReturnType<typeof vi.fn>;

  function configurarPrueba(idTokenResuelto: string | null) {
    obtenerIdTokenMock = vi.fn().mockResolvedValue(idTokenResuelto);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { obtenerIdToken: obtenerIdTokenMock } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(EditorialesDescuentosService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  describe('cargarDescuentos', () => {
    it('deja descuentos en [] y marca error cuando no hay ID Token (sin sesión)', async () => {
      const servicio = configurarPrueba(null);

      await servicio.cargarDescuentos();

      expect(servicio.descuentos()).toEqual([]);
      expect(servicio.error()).toBe(true);
    });

    it('resuelve el listado y actualiza el Signal cuando /api/editoriales-descuentos responde 200', async () => {
      const servicio = configurarPrueba('token-valido');
      const descuentosEsperados: DescuentoEditorial[] = [
        { editorial: 'Planeta', porcentajePorDefecto: 35, porcentajesDisponibles: [35, 40, 45] },
        { editorial: 'Independiente', porcentajePorDefecto: 20, porcentajesDisponibles: [] },
      ];

      const promesa = servicio.cargarDescuentos();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/editoriales-descuentos');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticion.flush(descuentosEsperados);
      await promesa;

      expect(servicio.descuentos()).toEqual(descuentosEsperados);
      expect(servicio.error()).toBe(false);
    });

    it('deja descuentos en [] y marca error cuando /api/editoriales-descuentos responde 403', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.cargarDescuentos();
      await Promise.resolve();
      httpMock
        .expectOne('/api/editoriales-descuentos')
        .flush({ error: 'Prohibido' }, { status: 403, statusText: 'Forbidden' });
      await promesa;

      expect(servicio.descuentos()).toEqual([]);
      expect(servicio.error()).toBe(true);
    });
  });

  describe('crearDescuento', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearDescuento({
        editorial: 'Planeta',
        porcentajePorDefecto: 35,
        porcentajesDisponibles: [35, 40],
      });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear el descuento editorial. Intenta de nuevo.' });
    });

    it('crea el descuento, recarga el listado y devuelve éxito cuando /api/editoriales-descuentos responde 201', async () => {
      const servicio = configurarPrueba('token-valido');
      const descuentoCreado: DescuentoEditorial = {
        editorial: 'Planeta',
        porcentajePorDefecto: 35,
        porcentajesDisponibles: [35, 40],
      };

      const promesa = servicio.crearDescuento({
        editorial: 'Planeta',
        porcentajePorDefecto: 35,
        porcentajesDisponibles: [35, 40],
      });
      await Promise.resolve();
      const peticionCrear = httpMock.expectOne('/api/editoriales-descuentos');
      expect(peticionCrear.request.method).toBe('POST');
      expect(peticionCrear.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticionCrear.flush(descuentoCreado, { status: 201, statusText: 'Created' });

      // Dos ticks: uno para que se resuelva `firstValueFrom` del POST, otro
      // para que `cargarDescuentos()` internamente resuelva su propio
      // `obtenerIdToken()` antes de emitir la petición GET.
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/editoriales-descuentos').flush([descuentoCreado]);

      expect(await promesa).toEqual({ exito: true });
      expect(servicio.descuentos()).toEqual([descuentoCreado]);
    });

    it('devuelve el mensaje de error del backend cuando /api/editoriales-descuentos responde 409', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearDescuento({
        editorial: 'Repetida',
        porcentajePorDefecto: 35,
        porcentajesDisponibles: [],
      });
      await Promise.resolve();
      httpMock
        .expectOne('/api/editoriales-descuentos')
        .flush({ error: 'Ya existe una configuración de descuento para esa editorial.' }, { status: 409, statusText: 'Conflict' });

      expect(await promesa).toEqual({
        exito: false,
        error: 'Ya existe una configuración de descuento para esa editorial.',
      });
    });
  });

  describe('actualizarDescuento', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.actualizarDescuento('Planeta', {
        porcentajePorDefecto: 40,
        porcentajesDisponibles: [40],
      });

      expect(resultado).toEqual({
        exito: false,
        error: 'No se pudo actualizar el descuento editorial. Intenta de nuevo.',
      });
    });

    it('actualiza el descuento, recarga el listado y devuelve éxito cuando /api/editoriales-descuentos/{editorial} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');
      const descuentoActualizado: DescuentoEditorial = {
        editorial: 'Planeta',
        porcentajePorDefecto: 40,
        porcentajesDisponibles: [40, 45],
      };

      const promesa = servicio.actualizarDescuento('Planeta', {
        porcentajePorDefecto: 40,
        porcentajesDisponibles: [40, 45],
      });
      await Promise.resolve();
      const peticionActualizar = httpMock.expectOne('/api/editoriales-descuentos/Planeta');
      expect(peticionActualizar.request.method).toBe('PUT');
      peticionActualizar.flush(descuentoActualizado);

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/editoriales-descuentos').flush([descuentoActualizado]);

      expect(await promesa).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando /api/editoriales-descuentos/{editorial} responde 404', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarDescuento('Inexistente', {
        porcentajePorDefecto: 40,
        porcentajesDisponibles: [],
      });
      await Promise.resolve();
      httpMock
        .expectOne('/api/editoriales-descuentos/Inexistente')
        .flush(
          { error: 'No existe una configuración de descuento para esa editorial.' },
          { status: 404, statusText: 'Not Found' },
        );

      expect(await promesa).toEqual({
        exito: false,
        error: 'No existe una configuración de descuento para esa editorial.',
      });
    });
  });

  describe('eliminarDescuento', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.eliminarDescuento('Planeta');

      expect(resultado).toEqual({
        exito: false,
        error: 'No se pudo eliminar el descuento editorial. Intenta de nuevo.',
      });
    });

    it('elimina el descuento, recarga el listado y devuelve éxito cuando /api/editoriales-descuentos/{editorial} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarDescuento('Planeta');
      await Promise.resolve();
      const peticionEliminar = httpMock.expectOne('/api/editoriales-descuentos/Planeta');
      expect(peticionEliminar.request.method).toBe('DELETE');
      peticionEliminar.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/editoriales-descuentos').flush([]);

      expect(await promesa).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando /api/editoriales-descuentos/{editorial} responde 404', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarDescuento('Inexistente');
      await Promise.resolve();
      httpMock
        .expectOne('/api/editoriales-descuentos/Inexistente')
        .flush(
          { error: 'No existe una configuración de descuento para esa editorial.' },
          { status: 404, statusText: 'Not Found' },
        );

      expect(await promesa).toEqual({
        exito: false,
        error: 'No existe una configuración de descuento para esa editorial.',
      });
    });
  });
});
