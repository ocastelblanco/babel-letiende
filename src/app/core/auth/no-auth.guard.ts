import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Si ya hay una sesión activa, redirige fuera de /login (a /) en vez de
 * dejar que el usuario vea la pantalla de ingreso de nuevo. Es solo
 * experiencia de usuario — la autorización real ocurre siempre en la
 * Lambda `api` (CLAUDE.md, A01).
 *
 * Espera `authService.esperarListo()` antes de decidir, mismo motivo que
 * `RoleGuard`. `/login` sigue en `RenderMode.Server`: en SSR
 * `esperarListo()` resuelve de inmediato (sin SDK, sin sesión real que
 * esperar), así que el peor caso es no saltarse la pantalla de login en un
 * refresh con sesión activa — nunca bloquea el acceso.
 */
export const NoAuthGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.esperarListo();

  if (authService.usuario()) {
    router.navigate(['/']);
    return false;
  }

  return true;
};
