import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { Venta } from '../models/venta.model';
import { VentaService } from './venta.service';

// `auth.service.ts` (importado arriba solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo motivo de mock que en
// `usuarios.service.spec.ts`.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

describe('VentaService', () => {
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
    return TestBed.inject(VentaService);
  }

  afterEach(() => {
    httpMock.verify();
  });

  describe('registrarVenta', () => {
    it('devuelve error sin llamar a la API cuando no hay ID Token (sin sesión)', async () => {
      const servicio = configurarPrueba(null);

      const resultado = await servicio.registrarVenta({
        bookId: 'book-1',
        cantidad: 1,
        porcentajeDescuentoVenta: 0,
        formaDePago: 'efectivo',
      });

      expect(resultado).toEqual({ exito: false, error: 'No se pudo registrar la venta. Intenta de nuevo.' });
    });

    it('registra la venta y devuelve éxito cuando /api/ventas responde 201', async () => {
      const servicio = configurarPrueba('token-valido');
      const ventaEsperada: Venta = {
        ventaId: 'venta-1',
        bookId: 'book-1',
        isbn: '9780000000000',
        cantidad: 2,
        pvp: 45000,
        porcentajeDescuentoVenta: 10,
        precioFinal: 81000,
        costoLibro: 29250,
        utilidad: 22500,
        formaDePago: 'efectivo',
        vendidoPor: 'vendedor@letiende.co',
        vendidoEn: '2026-07-24T00:00:00.000Z',
      };

      const promesa = servicio.registrarVenta({
        bookId: 'book-1',
        cantidad: 2,
        porcentajeDescuentoVenta: 10,
        formaDePago: 'efectivo',
      });
      await Promise.resolve();
      const peticion = httpMock.expectOne('/api/ventas');
      expect(peticion.request.method).toBe('POST');
      expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-valido');
      expect(peticion.request.body).toEqual({
        bookId: 'book-1',
        cantidad: 2,
        porcentajeDescuentoVenta: 10,
        formaDePago: 'efectivo',
      });
      peticion.flush(ventaEsperada, { status: 201, statusText: 'Created' });

      expect(await promesa).toEqual({ exito: true, venta: ventaEsperada });
    });

    it('devuelve el mensaje de error del backend cuando /api/ventas responde 400 (sin ejemplares suficientes)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.registrarVenta({
        bookId: 'book-1',
        cantidad: 5,
        porcentajeDescuentoVenta: 0,
        formaDePago: 'efectivo',
      });
      await Promise.resolve();
      httpMock
        .expectOne('/api/ventas')
        .flush(
          { error: 'No quedan suficientes ejemplares disponibles de este libro.' },
          { status: 400, statusText: 'Bad Request' },
        );

      expect(await promesa).toEqual({
        exito: false,
        error: 'No quedan suficientes ejemplares disponibles de este libro.',
      });
    });

    it('devuelve el mensaje de error del backend cuando /api/ventas responde 403 (rol insuficiente)', async () => {
      const servicio = configurarPrueba('token-valido');

      const promesa = servicio.registrarVenta({
        bookId: 'book-1',
        cantidad: 1,
        porcentajeDescuentoVenta: 0,
        formaDePago: 'efectivo',
      });
      await Promise.resolve();
      httpMock
        .expectOne('/api/ventas')
        .flush({ error: 'Este correo no está autorizado para registrar ventas en Babel.' }, { status: 403, statusText: 'Forbidden' });

      expect(await promesa).toEqual({
        exito: false,
        error: 'Este correo no está autorizado para registrar ventas en Babel.',
      });
    });
  });
});
