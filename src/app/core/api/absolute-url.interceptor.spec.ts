import { HttpRequest } from '@angular/common/http';
import { REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmbebidoService } from '../embebido/embebido.service';
import { absoluteUrlInterceptor } from './absolute-url.interceptor';

function configurar(embebido: boolean) {
  TestBed.configureTestingModule({
    providers: [
      { provide: REQUEST, useValue: null },
      { provide: EmbebidoService, useValue: { embebido } },
    ],
  });
}

describe('absoluteUrlInterceptor', () => {
  it('antepone el origen de REQUEST a una URL relativa (comportamiento en SSR)', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: REQUEST, useValue: new Request('https://babel.letiende.co/') },
        { provide: EmbebidoService, useValue: { embebido: false } },
      ],
    });
    const nextMock = vi.fn();

    TestBed.runInInjectionContext(() =>
      absoluteUrlInterceptor(new HttpRequest('GET', '/api/libros'), nextMock),
    );

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(nextMock.mock.calls[0][0].url).toBe('https://babel.letiende.co/api/libros');
  });

  it('deja la petición sin cambios cuando no hay REQUEST y no está embebida (navegador, dominio directo)', () => {
    configurar(false);
    const nextMock = vi.fn();
    const peticionOriginal = new HttpRequest('GET', '/api/libros');

    TestBed.runInInjectionContext(() => absoluteUrlInterceptor(peticionOriginal, nextMock));

    expect(nextMock).toHaveBeenCalledWith(peticionOriginal);
  });

  it('antepone /libros a una llamada de API en el navegador cuando está embebida (T-0014, hallazgo real)', () => {
    configurar(true);
    const nextMock = vi.fn();

    TestBed.runInInjectionContext(() =>
      absoluteUrlInterceptor(new HttpRequest('GET', '/api/libros'), nextMock),
    );

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(nextMock.mock.calls[0][0].url).toBe('/libros/api/libros');
  });

  it('no toca una URL que no sea de API aunque esté embebida (navegación normal del Router)', () => {
    configurar(true);
    const nextMock = vi.fn();
    const peticionOriginal = new HttpRequest('GET', '/otra-cosa');

    TestBed.runInInjectionContext(() => absoluteUrlInterceptor(peticionOriginal, nextMock));

    expect(nextMock).toHaveBeenCalledWith(peticionOriginal);
  });
});
