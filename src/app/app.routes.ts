import { Routes } from '@angular/router';
import { NoAuthGuard } from './core/auth/no-auth.guard';
import { RoleGuard } from './core/auth/role.guard';

export const routes: Routes = [
  // Pública (tech-specs.md §4.2): sin guard, sin sesión requerida.
  {
    path: '',
    loadComponent: () =>
      import('./features/catalogo-publico/catalogo-publico.component').then(
        (m) => m.CatalogoPublicoComponent,
      ),
    pathMatch: 'full',
  },
  {
    // Ficha de libro (tech-specs.md, módulo catalogo-publico/; TODO.md, ficha de libro) — pública, sin guard, mismo criterio que ''.
    path: 'libro/:bookId',
    loadComponent: () =>
      import('./features/catalogo-publico/libro-detalle.component').then(
        (m) => m.LibroDetalleComponent,
      ),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
    canActivate: [NoAuthGuard],
  },
  {
    // Área "Gestionar" (`TODO.md`) — reemplaza a `/libros`, ya eliminada: 2
    // pestañas (Catalogar/Editar) en un único componente
    // (`GestionarComponent`). La ruta de esta área es `/catalogar`.
    // POST/PUT /api/libros aceptan vendedor o administrador, mismo criterio
    // que antes.
    path: 'catalogar',
    loadComponent: () =>
      import('./features/gestionar/gestionar.component').then((m) => m.GestionarComponent),
    canActivate: [RoleGuard(['vendedor', 'administrador'])],
    // `title` inicial (pestaña "Catalogar") — `GestionarComponent` lo
    // sobreescribe al cambiar de pestaña (ver `TITULOS_PESTANA` ahí).
    title: 'Catalogar - Le Tiende',
  },
  {
    // Punto de entrada a la sección de administración (tech-specs.md §4.2) — solo administrador.
    path: 'admin',
    loadComponent: () =>
      import('./features/admin/admin-inicio.component').then((m) => m.AdminInicioComponent),
    canActivate: [RoleGuard('administrador')],
    title: 'Administración - Le Tiende',
  },
  {
    // CRUD del modelo jerárquico de ubicación física Espacio → Mueble →
    // Ubicación (tech-specs.md §4.2, TODO.md Tarea 2) — solo administrador,
    // mismo patrón que /admin. Reemplaza a la antigua /admin/estantes.
    path: 'admin/ubicaciones',
    loadComponent: () =>
      import('./features/admin/gestion-ubicacion-fisica.component').then(
        (m) => m.GestionUbicacionFisicaComponent,
      ),
    canActivate: [RoleGuard('administrador')],
    title: 'Ubicación física - Le Tiende',
  },
  {
    // CRUD de sitios de scraping (plan-obtencion-info-libros.md §6 Task A, ADR-010) — solo administrador, mismo patrón que /admin/estantes.
    path: 'admin/sitios',
    loadComponent: () =>
      import('./features/admin/gestion-sitios-scraping.component').then(
        (m) => m.GestionSitiosScrapingComponent,
      ),
    canActivate: [RoleGuard('administrador')],
    title: 'Sitios de scraping - Le Tiende',
  },
  {
    // CRUD de usuarios (PRD.md §5.6, TODO.md Tarea 1) — solo administrador, mismo patrón que /admin/estantes.
    path: 'admin/usuarios',
    loadComponent: () =>
      import('./features/admin/gestion-usuarios.component').then(
        (m) => m.GestionUsuariosComponent,
      ),
    canActivate: [RoleGuard('administrador')],
    title: 'Usuarios - Le Tiende',
  },
  {
    // CRUD de descuentos por editorial (PRD.md §5.6, TODO.md Tarea 1) — solo administrador, mismo patrón que /admin/usuarios.
    path: 'admin/editoriales',
    loadComponent: () =>
      import('./features/admin/gestion-descuentos-editoriales.component').then(
        (m) => m.GestionDescuentosEditorialesComponent,
      ),
    canActivate: [RoleGuard('administrador')],
    title: 'Descuentos editoriales - Le Tiende',
  },
  {
    // Exportación de reportes de ventas (PRD.md §5.5, TODO.md Tarea 1) — solo administrador, mismo patrón que /admin/usuarios.
    path: 'admin/reportes',
    loadComponent: () =>
      import('./features/admin/reportes-ventas.component').then((m) => m.ReportesVentasComponent),
    canActivate: [RoleGuard('administrador')],
    title: 'Reportes de ventas - Le Tiende',
  },
  {
    // Proceso asíncrono "Validar libros" (PVP + portada, por mueble) —
    // ADR-012, docs/plan-validar-libros-async.md — solo administrador,
    // mismo patrón que /admin/usuarios.
    path: 'admin/validar-libros',
    loadComponent: () =>
      import('./features/admin/validar-libros.component').then((m) => m.ValidarLibrosComponent),
    canActivate: [RoleGuard('administrador')],
    title: 'Validar libros - Le Tiende',
  },
  { path: '**', redirectTo: '' },
];
