import { Routes } from '@angular/router';
import { NoAuthGuard } from './core/auth/no-auth.guard';
import { RoleGuard } from './core/auth/role.guard';
import { AdminInicioComponent } from './features/admin/admin-inicio.component';
import { GestionDescuentosEditorialesComponent } from './features/admin/gestion-descuentos-editoriales.component';
import { GestionSitiosScrapingComponent } from './features/admin/gestion-sitios-scraping.component';
import { GestionUbicacionFisicaComponent } from './features/admin/gestion-ubicacion-fisica.component';
import { GestionUsuariosComponent } from './features/admin/gestion-usuarios.component';
import { ReportesVentasComponent } from './features/admin/reportes-ventas.component';
import { ValidarLibrosComponent } from './features/admin/validar-libros.component';
import { CatalogoPublicoComponent } from './features/catalogo-publico/catalogo-publico.component';
import { LibroDetalleComponent } from './features/catalogo-publico/libro-detalle.component';
import { GestionarComponent } from './features/gestionar/gestionar.component';
import { LoginComponent } from './features/login/login.component';

export const routes: Routes = [
  // Pública (tech-specs.md §4.2): sin guard, sin sesión requerida.
  { path: '', component: CatalogoPublicoComponent, pathMatch: 'full' },
  {
    // Ficha de libro (tech-specs.md, módulo catalogo-publico/; TODO.md, ficha de libro) — pública, sin guard, mismo criterio que ''.
    path: 'libro/:bookId',
    component: LibroDetalleComponent,
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [NoAuthGuard],
  },
  {
    // Área "Gestionar" (`TODO.md`) — reemplaza a `/libros`, ya eliminada: 2
    // pestañas (Catalogar/Editar) en un único componente
    // (`GestionarComponent`). La ruta de esta área es `/catalogar`.
    // POST/PUT /api/libros aceptan vendedor o administrador, mismo criterio
    // que antes.
    path: 'catalogar',
    component: GestionarComponent,
    canActivate: [RoleGuard(['vendedor', 'administrador'])],
  },
  {
    // Punto de entrada a la sección de administración (tech-specs.md §4.2) — solo administrador.
    path: 'admin',
    component: AdminInicioComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // CRUD del modelo jerárquico de ubicación física Espacio → Mueble →
    // Ubicación (tech-specs.md §4.2, TODO.md Tarea 2) — solo administrador,
    // mismo patrón que /admin. Reemplaza a la antigua /admin/estantes.
    path: 'admin/ubicaciones',
    component: GestionUbicacionFisicaComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // CRUD de sitios de scraping (plan-obtencion-info-libros.md §6 Task A, ADR-010) — solo administrador, mismo patrón que /admin/estantes.
    path: 'admin/sitios',
    component: GestionSitiosScrapingComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // CRUD de usuarios (PRD.md §5.6, TODO.md Tarea 1) — solo administrador, mismo patrón que /admin/estantes.
    path: 'admin/usuarios',
    component: GestionUsuariosComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // CRUD de descuentos por editorial (PRD.md §5.6, TODO.md Tarea 1) — solo administrador, mismo patrón que /admin/usuarios.
    path: 'admin/editoriales',
    component: GestionDescuentosEditorialesComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // Exportación de reportes de ventas (PRD.md §5.5, TODO.md Tarea 1) — solo administrador, mismo patrón que /admin/usuarios.
    path: 'admin/reportes',
    component: ReportesVentasComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // Proceso asíncrono "Validar libros" (PVP + portada, por mueble) —
    // ADR-012, docs/plan-validar-libros-async.md — solo administrador,
    // mismo patrón que /admin/usuarios.
    path: 'admin/validar-libros',
    component: ValidarLibrosComponent,
    canActivate: [RoleGuard('administrador')],
  },
  { path: '**', redirectTo: '' },
];
