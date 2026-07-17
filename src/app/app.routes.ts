import { Routes } from '@angular/router';
import { AuthGuard } from './core/auth/auth.guard';
import { NoAuthGuard } from './core/auth/no-auth.guard';
import { LoginComponent } from './features/login/login.component';
import { ListaLibrosCatalogadosComponent } from './features/libros/lista-libros-catalogados.component';

export const routes: Routes = [
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
  // Placeholder temporal: la raíz real será CatalogoPublicoComponent
  // (tech-specs.md §4.2), todavía fuera de alcance. Mientras tanto, redirige
  // a /libros para no dejar un 404 tras un login exitoso.
  { path: '', redirectTo: 'libros', pathMatch: 'full' },
  { path: '**', redirectTo: 'libros' },
];
