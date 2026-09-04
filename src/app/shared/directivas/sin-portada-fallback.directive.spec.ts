import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SinPortadaFallbackDirective } from './sin-portada-fallback.directive';

@Component({
  imports: [SinPortadaFallbackDirective],
  template: `<img appSinPortadaFallback src="https://ejemplo.com/portada-rota.jpg" alt="portada" />`,
})
class ComponenteDePrueba {}

function configurarPrueba(): { fixture: ComponentFixture<ComponenteDePrueba>; imagen: HTMLImageElement } {
  TestBed.configureTestingModule({ imports: [ComponenteDePrueba] });
  const fixture = TestBed.createComponent(ComponenteDePrueba);
  fixture.detectChanges();
  const imagen: HTMLImageElement = fixture.nativeElement.querySelector('img');
  return { fixture, imagen };
}

describe('SinPortadaFallbackDirective', () => {
  it('cambia el src a la portada genérica cuando la imagen falla al cargar', () => {
    const { imagen } = configurarPrueba();

    imagen.dispatchEvent(new Event('error'));

    expect(imagen.src).toContain('/portada-generica.svg');
  });

  it('no vuelve a cambiar el src si ya es la portada genérica (evita loop infinito)', () => {
    const { imagen } = configurarPrueba();

    imagen.dispatchEvent(new Event('error'));
    const srcTrasPrimerFallo = imagen.src;
    imagen.dispatchEvent(new Event('error'));

    expect(imagen.src).toBe(srcTrasPrimerFallo);
  });
});
