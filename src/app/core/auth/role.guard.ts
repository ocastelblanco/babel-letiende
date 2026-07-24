import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UsuariosService } from '../api/usuarios.service';
import { RolUsuario } from '../models/usuario.model';

/**
 * Guard de autorización (a diferencia de `AuthGuard`, que solo exige sesión
 * activa): exige que `GET /api/usuarios/me` resuelva un `Usuario` con uno de
 * los roles dados (`rolesPermitidos` acepta un solo rol o una lista — ej.
 * `POST /api/libros` acepta `vendedor` **o** `administrador`, a diferencia de
 * un endpoint exclusivo de `administrador`). Como `AuthGuard`, es solo
 * experiencia de usuario — la autorización real vuelve a verificarse siempre
 * en la Lambda `api` (CLAUDE.md A01/A07). Nunca asume autorización mientras
 * la respuesta de `/api/usuarios/me` no haya llegado.
 *
 * Redirige a `/` (catálogo público) en vez de `/gestionar` cuando el rol no
 * coincide — evita un bucle si el rol insuficiente es justo el que exige
 * `/gestionar` (`TODO.md`, área "Gestionar", reemplaza a `/libros`, ya
 * eliminada).
 */
export function RoleGuard(rolesPermitidos: RolUsuario | RolUsuario[]): CanActivateFn {
  const roles = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];

  return async () => {
    const usuariosService = inject(UsuariosService);
    const router = inject(Router);

    const usuario = await usuariosService.obtenerUsuarioActual();

    if (usuario && roles.includes(usuario.rol)) {
      return true;
    }

    router.navigate(['/']);
    return false;
  };
}
