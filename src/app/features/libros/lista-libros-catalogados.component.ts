import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder mínimo de la ruta /libros (tech-specs.md §4.2). Sirve por ahora
 * únicamente para verificar de punta a punta el flujo de AuthGuard — la
 * lista real de libros catalogados se implementa en una tarea futura del
 * roadmap. Mientras tanto, enlaza a `/catalogar` (único punto de navegación
 * accesible tras iniciar sesión, ver `TODO.md`).
 */
@Component({
  selector: 'app-lista-libros-catalogados',
  imports: [RouterLink],
  template: `
    <div class="p-8 text-primary">
      <p>Área protegida</p>
      <a routerLink="/catalogar" class="mt-2 inline-block text-sm font-semibold text-secondary underline">
        Catalogar un libro
      </a>
    </div>
  `,
})
export class ListaLibrosCatalogadosComponent {}
