import { HttpRequest } from '@angular/common/http';
import { REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { absoluteUrlInterceptor } from './absolute-url.interceptor';

describe('absoluteUrlInterceptor', () => {
  it('antepone el origen de REQUEST a una URL relativa (comportamiento en SSR)', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REQUEST, useValue: new Request('https://babel.letiende.co/') }],
    });
    const nextMock = vi.fn();

    TestBed.runInInjectionContext(() =>
      absoluteUrlInterceptor(new HttpRequest('GET', '/api/libros'), nextMock),
    );

    expect(nextMock).toHaveBeenCalledTimes(1);
    expect(nextMock.mock.calls[0][0].url).toBe('https://babel.letiende.co/api/libros');
  });

  it('deja la petición sin cambios cuando no hay REQUEST (comportamiento en el navegador)', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REQUEST, useValue: null }],
    });
    const nextMock = vi.fn();
    const peticionOriginal = new HttpRequest('GET', '/api/libros');

    TestBed.runInInjectionContext(() => absoluteUrlInterceptor(peticionOriginal, nextMock));

    expect(nextMock).toHaveBeenCalledWith(peticionOriginal);
  });
});
