import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { Usuario } from '../models/usuario.model';
import { UsuariosService } from './usuarios.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo. Se mockea aquí también (igual que en
// `auth.service.spec.ts`) para que este archivo nunca cargue el `firebase/auth`
// real — si lo hiciera antes de que corra `auth.service.spec.ts`, el registro
// de módulos del proceso quedaría "envenenado" con el real y su propio
// `vi.mock('firebase/auth', ...)` dejaría de surtir efecto.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

describe('UsuariosService', () => {
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
    return TestBed.inject(UsuariosService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('resuelve null sin llamar a la API cuando no hay ID Token (sin sesión)', async () => {
    const servicio = configurarPrueba(null);

    const resultado = await servicio.obtenerUsuarioActual();

    expect(resultado).toBeNull();
    expect(servicio.usuarioActual()).toBeNull();
  });

  it('resuelve null cuando /api/usuarios/me responde 403', async () => {
    const servicio = configurarPrueba('token-falso');

    const promesa = servicio.obtenerUsuarioActual();
    // Deja correr el microtask del `await` interno a `obtenerIdToken()`
    // (mockeado) antes de esperar que la petición HTTP ya se haya emitido.
    await Promise.resolve();
    const peticion = httpMock.expectOne('/api/usuarios/me');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-falso');
    peticion.flush({ error: 'Este correo no está autorizado en Babel.' }, { status: 403, statusText: 'Forbidden' });

    expect(await promesa).toBeNull();
  });

  it('resuelve el Usuario y actualiza el Signal cuando /api/usuarios/me responde 200', async () => {
    const servicio = configurarPrueba('token-valido');
    const usuarioEsperado: Usuario = {
      email: 'admin@letiende.co',
      nombre: 'Admin',
      fotoUrl: null,
      rol: 'administrador',
      creadoEn: '2026-07-19T00:00:00.000Z',
    };

    const promesa = servicio.obtenerUsuarioActual();
    // Deja correr el microtask del `await` interno a `obtenerIdToken()`
    // (mockeado) antes de esperar que la petición HTTP ya se haya emitido.
    await Promise.resolve();
    httpMock.expectOne('/api/usuarios/me').flush(usuarioEsperado);

    expect(await promesa).toEqual(usuarioEsperado);
    expect(servicio.usuarioActual()).toEqual(usuarioEsperado);
  });

  describe('cargarUsuarios', () => {
    it('deja usuarios en [] y marca error cuando no hay ID Token (sin sesión)', async () => {
      const servicio = configurarPrueba(null);

      await servicio.cargarUsuarios();

      expect(servicio.usuarios()).toEqual([]);
      expect(servicio.error()).toBe(true);
    });

    it('resuelve el listado y actualiza el Signal cuando /api/usuarios responde 200', async () => {
      const servicio = configurarPrueba('token-valido');
      const usuariosEsperados: Usuario[] = [
        { email: 'admin@letiende.co', nombre: 'Admin', fotoUrl: null, rol: 'administrador', creadoEn: '2026-07-19T00:00:00.000Z' },
        { email: 'vendedor@letiende.co', nombre: 'Vendedor', fotoUrl: null, rol: 'vendedor', creadoEn: '2026-07-19T00:00:00.000Z' },
      ];

      const promesa = servicio.cargarUsuarios();
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/usuarios');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticion.flush(usuariosEsperados);
      await promesa;

      expect(servicio.usuarios()).toEqual(usuariosEsperados);
      expect(servicio.error()).toBe(false);
    });

    it('deja usuarios en [] y marca error cuando /api/usuarios responde 403', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.cargarUsuarios();
      await Promise.resolve();
      httpMock.expectOne('/api/usuarios').flush({ error: 'Prohibido' }, { status: 403, statusText: 'Forbidden' });
      await promesa;

      expect(servicio.usuarios()).toEqual([]);
      expect(servicio.error()).toBe(true);
    });
  });

  describe('crearUsuario', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.crearUsuario({ email: 'nuevo@letiende.co', nombre: 'Nuevo', rol: 'vendedor' });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo crear el usuario. Intenta de nuevo.' });
    });

    it('crea el usuario, recarga el listado y devuelve éxito cuando /api/usuarios responde 201', async () => {
      const servicio = configurarPrueba('token-valido');
      const usuarioCreado: Usuario = {
        email: 'nuevo@letiende.co',
        nombre: 'Nuevo',
        fotoUrl: null,
        rol: 'vendedor',
        creadoEn: '2026-07-19T00:00:00.000Z',
      };

      const promesa = servicio.crearUsuario({ email: 'nuevo@letiende.co', nombre: 'Nuevo', rol: 'vendedor' });
      await Promise.resolve();
      const peticionCrear = httpMock.expectOne('/api/usuarios');
      expect(peticionCrear.request.method).toBe('POST');
      expect(peticionCrear.request.headers.get('Authorization')).toBe('Bearer token-valido');
      peticionCrear.flush(usuarioCreado, { status: 201, statusText: 'Created' });

      // Dos ticks: uno para que se resuelva `firstValueFrom` del POST, otro
      // para que `cargarUsuarios()` internamente resuelva su propio
      // `obtenerIdToken()` antes de emitir la petición GET.
      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/usuarios').flush([usuarioCreado]);

      expect(await promesa).toEqual({ exito: true });
      expect(servicio.usuarios()).toEqual([usuarioCreado]);
    });

    it('devuelve el mensaje de error del backend cuando /api/usuarios responde 409', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.crearUsuario({ email: 'repetido@letiende.co', nombre: 'Repetido', rol: 'vendedor' });
      await Promise.resolve();
      httpMock
        .expectOne('/api/usuarios')
        .flush({ error: 'Ya existe un usuario registrado con ese email.' }, { status: 409, statusText: 'Conflict' });

      expect(await promesa).toEqual({ exito: false, error: 'Ya existe un usuario registrado con ese email.' });
    });
  });

  describe('actualizarUsuario', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.actualizarUsuario('vendedor@letiende.co', { nombre: 'Vendedor', rol: 'vendedor' });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo actualizar el usuario. Intenta de nuevo.' });
    });

    it('actualiza el usuario, recarga el listado y devuelve éxito cuando /api/usuarios/{email} responde 200', async () => {
      const servicio = configurarPrueba('token-valido');
      const usuarioActualizado: Usuario = {
        email: 'vendedor@letiende.co',
        nombre: 'Vendedor Actualizado',
        fotoUrl: null,
        rol: 'vendedor',
        creadoEn: '2026-07-19T00:00:00.000Z',
      };

      const promesa = servicio.actualizarUsuario('vendedor@letiende.co', { nombre: 'Vendedor Actualizado', rol: 'vendedor' });
      await Promise.resolve();
      const peticionActualizar = httpMock.expectOne('/api/usuarios/vendedor@letiende.co');
      expect(peticionActualizar.request.method).toBe('PUT');
      peticionActualizar.flush(usuarioActualizado);

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/usuarios').flush([usuarioActualizado]);

      expect(await promesa).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando la salvaguarda ADR-009 bloquea el cambio de rol propio (400)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.actualizarUsuario('admin@letiende.co', { nombre: 'Admin', rol: 'vendedor' });
      await Promise.resolve();
      httpMock.expectOne('/api/usuarios/admin@letiende.co').flush(
        { error: 'No puedes degradar tu propio rol de administrador. Pídele a otro administrador que lo haga.' },
        { status: 400, statusText: 'Bad Request' },
      );

      expect(await promesa).toEqual({
        exito: false,
        error: 'No puedes degradar tu propio rol de administrador. Pídele a otro administrador que lo haga.',
      });
    });
  });

  describe('eliminarUsuario', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.eliminarUsuario('vendedor@letiende.co');

      expect(resultado).toEqual({ exito: false, error: 'No se pudo eliminar el usuario. Intenta de nuevo.' });
    });

    it('elimina el usuario, recarga el listado y devuelve éxito cuando /api/usuarios/{email} responde 204', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarUsuario('vendedor@letiende.co');
      await Promise.resolve();
      const peticionEliminar = httpMock.expectOne('/api/usuarios/vendedor@letiende.co');
      expect(peticionEliminar.request.method).toBe('DELETE');
      peticionEliminar.flush(null, { status: 204, statusText: 'No Content' });

      await Promise.resolve();
      await Promise.resolve();
      httpMock.expectOne('/api/usuarios').flush([]);

      expect(await promesa).toEqual({ exito: true });
    });

    it('devuelve el mensaje de error del backend cuando la salvaguarda ADR-009 bloquea la autoeliminación (400)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.eliminarUsuario('admin@letiende.co');
      await Promise.resolve();
      httpMock
        .expectOne('/api/usuarios/admin@letiende.co')
        .flush(
          { error: 'No puedes eliminarte a ti mismo. Pídele a otro administrador que lo haga.' },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(await promesa).toEqual({
        exito: false,
        error: 'No puedes eliminarte a ti mismo. Pídele a otro administrador que lo haga.',
      });
    });
  });
});
