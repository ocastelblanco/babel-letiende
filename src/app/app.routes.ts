import { Routes } from '@angular/router';
import { AuthGuard } from './core/auth/auth.guard';
import { NoAuthGuard } from './core/auth/no-auth.guard';
import { CatalogoPublicoComponent } from './features/catalogo-publico/catalogo-publico.component';
import { LoginComponent } from './features/login/login.component';
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
  { path: '**', redirectTo: '' },
];
