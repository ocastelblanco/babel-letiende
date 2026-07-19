import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UsuariosService } from '../api/usuarios.service';
import { RolUsuario } from '../models/usuario.model';

/**
 * Guard de autorización (a diferencia de `AuthGuard`, que solo exige sesión
 * activa): exige que `GET /api/usuarios/me` resuelva un `Usuario` con el rol
 * dado. Como `AuthGuard`, es solo experiencia de usuario — la autorización
 * real vuelve a verificarse siempre en la Lambda `api` (CLAUDE.md A01/A07).
 * Nunca asume autorización mientras la respuesta de `/api/usuarios/me` no
 * haya llegado.
 */
export function RoleGuard(rolRequerido: RolUsuario): CanActivateFn {
  return async () => {
    const usuariosService = inject(UsuariosService);
    const router = inject(Router);

    const usuario = await usuariosService.obtenerUsuarioActual();

    if (usuario?.rol === rolRequerido) {
      return true;
    }

    router.navigate(['/libros']);
    return false;
  };
}
