import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AsistenteService, MAXIMO_MENSAJES_POR_PETICION, type MensajeHistorial } from './asistente.service';

describe('AsistenteService', () => {
  let servicio: AsistenteService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    servicio = TestBed.inject(AsistenteService);
    httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  const historial = (n: number): MensajeHistorial[] =>
    Array.from({ length: n }, (_, i) => ({ rol: i % 2 === 0 ? 'usuario' : 'asistente', texto: `m${i}` }));

  describe('estaDisponible', () => {
    it('es true solo si el servidor responde disponible: true', async () => {
      const p = servicio.estaDisponible();
      httpMock.expectOne({ url: '/api/asistente', method: 'GET' }).flush({ disponible: true });
      expect(await p).toBe(true);
    });

    it('es false si dice false, si la respuesta es rara o si falla', async () => {
      for (const cuerpo of [{ disponible: false }, { disponible: 'true' }, {}]) {
        const p = servicio.estaDisponible();
        httpMock.expectOne('/api/asistente').flush(cuerpo);
        expect(await p).toBe(false);
      }
      const p = servicio.estaDisponible();
      httpMock.expectOne('/api/asistente').flush('x', { status: 500, statusText: 'Error' });
      expect(await p).toBe(false);
    });
  });

  describe('recortarHistorial', () => {
    it('no toca un historial que cabe', () => {
      expect(servicio.recortarHistorial(historial(5))).toHaveLength(5);
    });

    it('conserva los últimos 9 y siempre empieza con la persona', () => {
      const recortado = servicio.recortarHistorial(historial(13));
      expect(recortado).toHaveLength(MAXIMO_MENSAJES_POR_PETICION);
      expect(recortado[0]?.rol).toBe('usuario');
      expect(recortado[recortado.length - 1]?.texto).toBe('m12');
    });
  });

  describe('preguntar', () => {
    it('envía el historial (con los libros recomendados antes) sin credenciales y devuelve la respuesta', async () => {
      const mensajes: MensajeHistorial[] = [
        { rol: 'usuario', texto: 'una novela' },
        { rol: 'asistente', texto: 'Te sugiero este.', libros: ['b1'] },
        { rol: 'usuario', texto: '¿cuánto cuesta?' },
      ];
      const p = servicio.preguntar(mensajes);
      const peticion = httpMock.expectOne({ url: '/api/asistente', method: 'POST' });
      expect(peticion.request.headers.has('Authorization')).toBe(false);
      expect(peticion.request.body).toEqual({ mensajes, filtros: {} });
      peticion.flush({ texto: 'Cuesta $30.000.', recomendaciones: [], sinResultados: false, registroId: 'r-1' });
      expect(await p).toMatchObject({ exito: true, respuesta: { texto: 'Cuesta $30.000.', registroId: 'r-1' } });
    });

    it('no envía más de 9 mensajes', async () => {
      const p = servicio.preguntar(historial(11));
      const peticion = httpMock.expectOne('/api/asistente');
      expect((peticion.request.body as { mensajes: unknown[] }).mensajes).toHaveLength(9);
      peticion.flush({ texto: 'x', recomendaciones: [], sinResultados: true, registroId: null });
      await p;
    });

    it('distingue saturación (503 con motivo), no disponible (503 sin motivo) y error propio (502)', async () => {
      const casos: [number, object, string][] = [
        [503, { error: 'Hay mucha gente.', motivo: 'saturado' }, 'saturado'],
        [503, { error: 'El asistente no está disponible por ahora.' }, 'no-disponible'],
        [502, { error: 'Se me enredaron las páginas.', motivo: 'error-modelo' }, 'error'],
      ];
      for (const [estado, cuerpo, motivo] of casos) {
        const p = servicio.preguntar(historial(1));
        httpMock.expectOne('/api/asistente').flush(cuerpo, { status: estado, statusText: 'x' });
        const r = await p;
        expect(r).toMatchObject({ exito: false, motivo });
        expect((r as { mensaje: string }).mensaje).toBe((cuerpo as { error: string }).error);
      }
    });

    it('distingue el tope de mensajes del día (429 con error) del límite de tasa de API Gateway (429 con message)', async () => {
      let p = servicio.preguntar(historial(1));
      httpMock.expectOne('/api/asistente').flush({ error: 'Llegaste al límite de mensajes de hoy.' }, { status: 429, statusText: 'x' });
      expect(await p).toMatchObject({ exito: false, motivo: 'limite-visitante', mensaje: 'Llegaste al límite de mensajes de hoy.' });
      p = servicio.preguntar(historial(1));
      httpMock.expectOne('/api/asistente').flush({ message: 'Too Many Requests' }, { status: 429, statusText: 'x' });
      const r = await p;
      expect(r).toMatchObject({ exito: false, motivo: 'limite-tasa' });
      // El texto en inglés de API Gateway nunca llega a la persona.
      expect((r as { mensaje: string }).mensaje).not.toContain('Too Many');
    });

    it('un fallo de red da un mensaje propio y nunca lanza', async () => {
      const p = servicio.preguntar(historial(1));
      httpMock.expectOne('/api/asistente').error(new ProgressEvent('error'));
      expect(await p).toMatchObject({ exito: false, motivo: 'error' });
    });
  });

  describe('valorar', () => {
    it('envía registroId y valoración, y devuelve true si queda guardada', async () => {
      const p = servicio.valorar('r-1', 'negativa');
      const peticion = httpMock.expectOne({ url: '/api/asistente/valoracion', method: 'POST' });
      expect(peticion.request.body).toEqual({ registroId: 'r-1', valoracion: 'negativa' });
      peticion.flush({ ok: true });
      expect(await p).toBe(true);
    });

    it('devuelve false si falla', async () => {
      const p = servicio.valorar('r-1', 'positiva');
      httpMock.expectOne('/api/asistente/valoracion').flush({ error: 'No puedes valorar esa respuesta.' }, { status: 403, statusText: 'x' });
      expect(await p).toBe(false);
    });
  });
});
