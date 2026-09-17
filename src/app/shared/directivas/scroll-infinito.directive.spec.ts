import { Component, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScrollInfinitoDirective } from './scroll-infinito.directive';

/**
 * Mock mínimo de `IntersectionObserver` — jsdom no lo implementa. Guarda el
 * callback registrado para poder disparar la intersección manualmente desde
 * las pruebas, igual que se simula el evento `error` en
 * `sin-portada-fallback.directive.spec.ts`.
 */
let callbackRegistrado: IntersectionObserverCallback | undefined;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

class IntersectionObserverFalso {
  constructor(callback: IntersectionObserverCallback) {
    callbackRegistrado = callback;
  }
  observe = observeMock;
  disconnect = disconnectMock;
  unobserve = vi.fn();
}

function dispararInterseccion(esVisible: boolean): void {
  callbackRegistrado?.(
    [{ isIntersecting: esVisible } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

@Component({
  imports: [ScrollInfinitoDirective],
  template: `<div appScrollInfinito (alcanzarFinal)="alcanzarFinal()"></div>`,
})
class ComponenteDePrueba {
  alcanzarFinalLlamado = false;
  alcanzarFinal(): void {
    this.alcanzarFinalLlamado = true;
  }
}

function configurarPrueba(esBrowser = true): {
  fixture: ComponentFixture<ComponenteDePrueba>;
  componente: ComponenteDePrueba;
} {
  TestBed.configureTestingModule({
    imports: [ComponenteDePrueba],
    providers: [{ provide: PLATFORM_ID, useValue: esBrowser ? 'browser' : 'server' }],
  });
  const fixture = TestBed.createComponent(ComponenteDePrueba);
  fixture.detectChanges();
  return { fixture, componente: fixture.componentInstance };
}

describe('ScrollInfinitoDirective', () => {
  const IntersectionObserverOriginal = globalThis.IntersectionObserver;

  beforeEach(() => {
    callbackRegistrado = undefined;
    observeMock.mockClear();
    disconnectMock.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.IntersectionObserver = IntersectionObserverFalso as any;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = IntersectionObserverOriginal;
  });

  it('no dispara alcanzarFinal antes de intersectar', () => {
    const { componente } = configurarPrueba();

    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(componente.alcanzarFinalLlamado).toBe(false);
  });

  it('dispara alcanzarFinal cuando el elemento se vuelve visible', () => {
    const { componente } = configurarPrueba();

    dispararInterseccion(true);

    expect(componente.alcanzarFinalLlamado).toBe(true);
  });

  it('no dispara alcanzarFinal cuando la entrada no está intersectando', () => {
    const { componente } = configurarPrueba();

    dispararInterseccion(false);

    expect(componente.alcanzarFinalLlamado).toBe(false);
  });

  it('desconecta el observer al destruirse', () => {
    const { fixture } = configurarPrueba();

    fixture.destroy();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('no rompe en SSR (sin IntersectionObserver disponible, platform "server")', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).IntersectionObserver;

    expect(() => configurarPrueba(false)).not.toThrow();
    expect(observeMock).not.toHaveBeenCalled();
  });
});
