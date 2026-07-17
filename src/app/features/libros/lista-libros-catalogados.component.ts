import { Component } from '@angular/core';

/**
 * Placeholder mínimo de la ruta /libros (tech-specs.md §4.2). Sirve por ahora
 * únicamente para verificar de punta a punta el flujo de AuthGuard — la
 * lista real de libros catalogados se implementa en una tarea futura del
 * roadmap.
 */
@Component({
  selector: 'app-lista-libros-catalogados',
  template: `<p class="p-8 text-[#230C00]">Área protegida</p>`,
})
export class ListaLibrosCatalogadosComponent {}
