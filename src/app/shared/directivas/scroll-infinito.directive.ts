import { Directive, ElementRef, OnDestroy, OnInit, PLATFORM_ID, inject, output } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Directiva de "centinela" para renderizado incremental (windowing) de listas
 * largas — usada por `EditarLibroComponent` y `CatalogoPublicoComponent` para
 * no renderizar al DOM el arreglo COMPLETO de 3.000+ libros de una sola vez
 * (`docs/plan-rendimiento-catalogo.md`).
 *
 * Se coloca al final de la lista/grilla ya renderizada; cuando el elemento
 * host entra en el viewport (`IntersectionObserver`), emite `alcanzarFinal`
 * para que el componente padre aumente su límite de renderizado. El scroll
 * sigue siendo el nativo de `window` — esta directiva no introduce ningún
 * contenedor de scroll propio.
 *
 * SSR-safe: `IntersectionObserver` no existe en el servidor, así que todo su
 * uso queda detrás de `isPlatformBrowser` — mismo patrón que
 * `AuthService`/`EmbebidoService`/el botón "Volver arriba" de
 * `CatalogoPublicoComponent`.
 */
@Directive({
  selector: '[appScrollInfinito]',
})
export class ScrollInfinitoDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly platformId = inject(PLATFORM_ID);
  private observador: IntersectionObserver | undefined;

  /** Se emite cuando el elemento host (el centinela) se vuelve visible en el viewport. */
  readonly alcanzarFinal = output<void>();

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.observador = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) {
          this.alcanzarFinal.emit();
        }
      }
    });
    this.observador.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }
}
