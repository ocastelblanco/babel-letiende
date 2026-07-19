import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { eliminar, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

type RolUsuario = 'administrador' | 'vendedor';
const ROLES_USUARIO: readonly RolUsuario[] = ['administrador', 'vendedor'];

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que en `usuarios-me.ts`. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: RolUsuario;
  creadoEn: string;
}

function respuestaJson(statusCode: number, cuerpo?: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  };
}

function nombreTablaUsuarios(): string {
  const nombre = process.env['TABLA_USUARIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_USUARIOS.');
  }
  return nombre;
}

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Verifica el ID Token y exige rol `administrador` exclusivamente (CLAUDE.md
 * A01) — mismo patrón que `estantes.ts`. Devuelve el email verificado (para
 * el chequeo de auto-degradación/auto-eliminación del punto 3 de la tarea)
 * o `null` si el rol no alcanza.
 */
async function exigirAdministrador(headerAuthorization: string | undefined): Promise<string | null> {
  const { email } = await verificarTokenDesdeHeader(headerAuthorization);
  const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
  return usuario?.rol === 'administrador' ? email : null;
}

/** Datos aceptados en el body de `POST /api/usuarios`. */
interface DatosNuevoUsuario {
  email: string;
  nombre: string;
  rol: RolUsuario;
}

type ResultadoValidacionNuevo =
  | { valido: true; datos: DatosNuevoUsuario }
  | { valido: false; error: string };

/**
 * Valida el body de `POST /api/usuarios`. Exportada para poder probarla sin
 * invocar el handler completo (mismo patrón que `validarDatosEstante`).
 */
export function validarDatosNuevoUsuario(cuerpo: unknown): ResultadoValidacionNuevo {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['email'] !== 'string' || !PATRON_EMAIL.test(datos['email'])) {
    return { valido: false, error: 'El email es requerido y debe tener un formato válido.' };
  }
  if (typeof datos['nombre'] !== 'string' || datos['nombre'].trim() === '') {
    return { valido: false, error: 'El nombre es requerido.' };
  }
  if (typeof datos['rol'] !== 'string' || !ROLES_USUARIO.includes(datos['rol'] as RolUsuario)) {
    return { valido: false, error: `El rol debe ser uno de: ${ROLES_USUARIO.join(', ')}.` };
  }

  return {
    valido: true,
    datos: { email: datos['email'], nombre: datos['nombre'], rol: datos['rol'] as RolUsuario },
  };
}

/** Datos aceptados en el body de `PUT /api/usuarios/:email` — el email no se puede cambiar, es la clave primaria. */
interface DatosActualizacionUsuario {
  nombre: string;
  rol: RolUsuario;
}

type ResultadoValidacionActualizacion =
  | { valido: true; datos: DatosActualizacionUsuario }
  | { valido: false; error: string };

/**
 * Valida el body de `PUT /api/usuarios/:email`. Exportada para poder
 * probarla sin invocar el handler completo.
 */
export function validarActualizacionUsuario(cuerpo: unknown): ResultadoValidacionActualizacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['nombre'] !== 'string' || datos['nombre'].trim() === '') {
    return { valido: false, error: 'El nombre es requerido.' };
  }
  if (typeof datos['rol'] !== 'string' || !ROLES_USUARIO.includes(datos['rol'] as RolUsuario)) {
    return { valido: false, error: `El rol debe ser uno de: ${ROLES_USUARIO.join(', ')}.` };
  }

  return { valido: true, datos: { nombre: datos['nombre'], rol: datos['rol'] as RolUsuario } };
}

/**
 * CRUD `/api/usuarios` (tech-specs.md §5, "Admin"): las 4 operaciones exigen
 * rol `administrador` exclusivamente. Un solo Lambda para los 4 verbos
 * (ADR-008, mismo patrón que `estantes.ts`), distinguidos por
 * `event.requestContext.http.method`.
 *
 * **Salvaguarda de auto-degradación/auto-eliminación (ADR-009, `TODO.md`
 * punto 3):** un administrador nunca puede cambiar su propio rol ni
 * eliminarse a sí mismo a través de este endpoint — evita dejar
 * accidentalmente `babel-usuarios` sin ningún administrador (bloqueo total
 * del panel admin). Debe hacerlo otro administrador.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const emailAdministrador = await exigirAdministrador(event.headers['authorization']);
    if (!emailAdministrador) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para administrar usuarios en Babel.' });
    }

    const metodo = event.requestContext.http.method;
    const emailObjetivo = event.pathParameters?.['email'];

    if (metodo === 'GET') {
      const usuarios = await escanearTodo<Usuario>(nombreTablaUsuarios());
      return respuestaJson(200, usuarios);
    }

    if (metodo === 'POST') {
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosNuevoUsuario(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const existente = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email: validacion.datos.email });
      if (existente) {
        return respuestaJson(409, { error: 'Ya existe un usuario con ese email.' });
      }
      const usuario: Usuario = {
        email: validacion.datos.email,
        nombre: validacion.datos.nombre,
        rol: validacion.datos.rol,
        fotoUrl: null,
        creadoEn: new Date().toISOString(),
      };
      await guardar(nombreTablaUsuarios(), usuario);
      return respuestaJson(201, usuario);
    }

    if (metodo === 'PUT') {
      if (!emailObjetivo) {
        return respuestaJson(400, { error: 'Falta el email en la ruta.' });
      }
      const existente = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email: emailObjetivo });
      if (!existente) {
        return respuestaJson(404, { error: 'El usuario no existe.' });
      }
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarActualizacionUsuario(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      if (emailObjetivo === emailAdministrador && validacion.datos.rol !== 'administrador') {
        return respuestaJson(400, {
          error: 'No puedes degradar tu propio rol de administrador. Pídele a otro administrador que lo haga.',
        });
      }
      const usuario: Usuario = { ...existente, nombre: validacion.datos.nombre, rol: validacion.datos.rol };
      await guardar(nombreTablaUsuarios(), usuario);
      return respuestaJson(200, usuario);
    }

    if (metodo === 'DELETE') {
      if (!emailObjetivo) {
        return respuestaJson(400, { error: 'Falta el email en la ruta.' });
      }
      if (emailObjetivo === emailAdministrador) {
        return respuestaJson(400, {
          error: 'No puedes eliminarte a ti mismo. Pídele a otro administrador que lo haga.',
        });
      }
      const existente = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email: emailObjetivo });
      if (!existente) {
        return respuestaJson(404, { error: 'El usuario no existe.' });
      }
      await eliminar(nombreTablaUsuarios(), { email: emailObjetivo });
      return respuestaJson(204);
    }

    return respuestaJson(405, { error: 'Método no soportado.' });
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
