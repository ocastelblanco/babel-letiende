import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guard de solo experiencia de usuario: redirige a /login si no hay sesión.
 * La autorización real ocurre siempre en la Lambda `api` (verifyIdToken +
 * consulta a babel-usuarios) — nunca confiar en el cliente (CLAUDE.md, A01).
 *
 * Espera `authService.esperarListo()` antes de decidir: `onAuthStateChanged`
 * es asíncrono incluso para restaurar una sesión ya persistida, así que leer
 * `usuario()` de inmediato expulsaría a un usuario con sesión real. Por el
 * mismo motivo, la ruta que use este guard debe renderizar con
 * `RenderMode.Client` (`app.routes.server.ts`) — en SSR nunca existe el SDK
 * de Firebase, así que la decisión real solo puede tomarse en el navegador.
 */
export const AuthGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.esperarListo();

  if (authService.usuario()) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};
