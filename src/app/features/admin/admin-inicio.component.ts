import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Ruta protegida `/admin` (`RoleGuard('administrador')`, tech-specs.md §4.2).
 * Punto de entrada real y mínimo a la sección de administración: un índice
 * con enlaces a cada pantalla de configuración. "Estantes" ya enlaza a
 * `/admin/estantes` (`TODO.md` Tarea 2), "Sitios de scraping" a
 * `/admin/sitios` (`plan-obtencion-info-libros.md` §6 Task A), "Usuarios" a
 * `/admin/usuarios` (`TODO.md` Tarea 1), "Editoriales" a `/admin/editoriales`
 * (`TODO.md` Tarea 1) y "Reportes" a `/admin/reportes` (`TODO.md` Tarea 1).
 */
@Component({
  selector: 'app-admin-inicio',
  imports: [RouterLink],
  templateUrl: './admin-inicio.component.html',
})
export class AdminInicioComponent {}
