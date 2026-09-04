import { Directive } from '@angular/core';

const PORTADA_GENERICA = '/portada-generica.svg';

/**
 * Reemplaza la portada de un libro por el placeholder genérico cuando la
 * imagen falla al cargar (ej. el proveedor de scraping borró la URL
 * guardada). El guard de `src` evita un loop infinito si el propio SVG
 * genérico llegara a fallar en cargar.
 */
@Directive({
  selector: 'img[appSinPortadaFallback]',
  host: {
    '(error)': 'alFallarCarga($event)',
  },
})
export class SinPortadaFallbackDirective {
  protected alFallarCarga(evento: Event): void {
    const imagen = evento.target as HTMLImageElement;
    if (!imagen.src.endsWith(PORTADA_GENERICA)) {
      imagen.src = PORTADA_GENERICA;
    }
  }
}
