import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guard inverso de AuthGuard: si ya hay una sesión activa, redirige fuera de
 * /login (a /) en vez de dejar que el usuario vea la pantalla de ingreso de
 * nuevo. Al igual que AuthGuard, es solo experiencia de usuario — la
 * autorización real ocurre siempre en la Lambda `api` (CLAUDE.md, A01).
 */
export const NoAuthGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.usuario()) {
    router.navigate(['/']);
    return false;
  }

  return true;
};
