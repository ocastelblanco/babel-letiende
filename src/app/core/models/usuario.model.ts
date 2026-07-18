export type RolUsuario = 'administrador' | 'vendedor';

/**
 * Usuario autorizado en Babel (tech-specs.md §4.3, §8).
 *
 * Vive en `babel-usuarios`, independiente de cualquier registro de usuario
 * que ese mismo correo tenga en Comandante (MEMORY.md ADR-007) — estar
 * autenticado en el proyecto Firebase compartido no implica que exista un
 * `Usuario` aquí ni ningún rol.
 */
export interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: RolUsuario;
  /** Fecha ISO. */
  creadoEn: string;
}
