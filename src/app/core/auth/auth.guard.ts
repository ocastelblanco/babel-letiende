import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guard de solo experiencia de usuario: redirige a /login si no hay sesión.
 * La autorización real ocurre siempre en la Lambda `api` (verifyIdToken +
 * consulta a babel-usuarios) — nunca confiar en el cliente (CLAUDE.md, A01).
 */
export const AuthGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.usuario()) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};
