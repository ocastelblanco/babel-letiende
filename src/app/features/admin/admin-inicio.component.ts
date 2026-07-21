import { Component } from '@angular/core';

/**
 * Ruta protegida `/admin` (`RoleGuard('administrador')`, tech-specs.md §4.2).
 * Punto de entrada real y mínimo a la sección de administración: un índice
 * con enlaces a cada pantalla futura (Estantes, Usuarios, Editoriales,
 * Reportes) — ninguna implementada todavía, esas quedan como tareas
 * independientes de roadmap. Los `<a>` sin `routerLink` son intencionales
 * mientras esas rutas no existan.
 */
@Component({
  selector: 'app-admin-inicio',
  imports: [],
  templateUrl: './admin-inicio.component.html',
})
export class AdminInicioComponent {}
