import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Ruta protegida `/admin` (`RoleGuard('administrador')`, tech-specs.md §4.2).
 * Punto de entrada real y mínimo a la sección de administración: un índice
 * con enlaces a cada pantalla de configuración. "Estantes" ya enlaza a
 * `/admin/estantes` (`TODO.md` Tarea 2); Usuarios, Editoriales y Reportes
 * quedan como tareas independientes de roadmap — sus `<a>` sin `routerLink`
 * son intencionales mientras esas rutas no existan.
 */
@Component({
  selector: 'app-admin-inicio',
  imports: [RouterLink],
  templateUrl: './admin-inicio.component.html',
})
export class AdminInicioComponent {}
