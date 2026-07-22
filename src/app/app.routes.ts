import { Routes } from '@angular/router';
import { AuthGuard } from './core/auth/auth.guard';
import { NoAuthGuard } from './core/auth/no-auth.guard';
import { RoleGuard } from './core/auth/role.guard';
import { AdminInicioComponent } from './features/admin/admin-inicio.component';
import { GestionDescuentosEditorialesComponent } from './features/admin/gestion-descuentos-editoriales.component';
import { GestionEstantesComponent } from './features/admin/gestion-estantes.component';
import { GestionSitiosScrapingComponent } from './features/admin/gestion-sitios-scraping.component';
import { GestionUsuariosComponent } from './features/admin/gestion-usuarios.component';
import { CatalogarLibroComponent } from './features/catalogar/catalogar-libro.component';
import { CatalogoPublicoComponent } from './features/catalogo-publico/catalogo-publico.component';
import { LoginComponent } from './features/login/login.component';
import { CambiarEstanteComponent } from './features/libros/cambiar-estante.component';
import { ListaLibrosCatalogadosComponent } from './features/libros/lista-libros-catalogados.component';

export const routes: Routes = [
  // Pública (tech-specs.md §4.2): sin guard, sin sesión requerida.
  { path: '', component: CatalogoPublicoComponent, pathMatch: 'full' },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [NoAuthGuard],
  },
  {
    path: 'libros',
    component: ListaLibrosCatalogadosComponent,
    canActivate: [AuthGuard],
  },
  {
    // Vendedor y administrador pueden mover un libro de estante (tech-specs.md §4.2) — solo AuthGuard, no RoleGuard.
    path: 'libros/:bookId/estante',
    component: CambiarEstanteComponent,
    canActivate: [AuthGuard],
  },
  {
    // POST /api/libros acepta vendedor o administrador (TODO.md, catalogación manual).
    path: 'catalogar',
    component: CatalogarLibroComponent,
    canActivate: [RoleGuard(['vendedor', 'administrador'])],
  },
  {
    // Punto de entrada a la sección de administración (tech-specs.md §4.2) — solo administrador.
    path: 'admin',
    component: AdminInicioComponent,
    canActivate: [RoleGuard('administrador')],
  },
  {
    // CRUD de estantes (tech-specs.md §4.2, TODO.md Tarea 2) — solo administrador, mismo patrón que /admin.
    path: 'admin/estantes',
    component: GestionEstantesComponent,
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
  { path: '**', redirectTo: '' },
];
