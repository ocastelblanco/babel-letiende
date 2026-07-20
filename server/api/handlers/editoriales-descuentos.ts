import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { eliminar, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

/** Copia local de `src/app/core/models/descuento-editorial.model.ts` — mismo motivo que en otros handlers. */
interface DescuentoEditorial {
  editorial: string;
  porcentajePorDefecto: number;
  porcentajesDisponibles: number[];
}

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que en otros handlers. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}

function respuestaJson(statusCode: number, cuerpo?: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  };
}

function nombreTablaEditorialesDescuentos(): string {
  const nombre = process.env['TABLA_EDITORIALES_DESCUENTOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_EDITORIALES_DESCUENTOS.');
  }
  return nombre;
}

function nombreTablaUsuarios(): string {
  const nombre = process.env['TABLA_USUARIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_USUARIOS.');
  }
  return nombre;
}

/**
 * Verifica el ID Token y exige rol `administrador` exclusivamente (CLAUDE.md
 * A01) — mismo patrón que `estantes.ts`/`usuarios.ts`.
 */
async function exigirAdministrador(headerAuthorization: string | undefined): Promise<string | null> {
  const { email } = await verificarTokenDesdeHeader(headerAuthorization);
  const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
  return usuario?.rol === 'administrador' ? email : null;
}

/** Datos aceptados en el body de `POST`/`PUT /api/editoriales-descuentos` — sin `editorial` en `PUT` (clave primaria, va en el path). */
interface DatosDescuentoEditorial {
  porcentajePorDefecto: number;
  porcentajesDisponibles: number[];
}

function porcentajeValido(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 100;
}

type ResultadoValidacion =
  | { valido: true; datos: DatosDescuentoEditorial }
  | { valido: false; error: string };

/**
 * Valida el body de `POST`/`PUT /api/editoriales-descuentos`. Exportada para
 * poder probarla sin invocar el handler completo (mismo patrón que
 * `validarDatosEstante`/`validarDatosNuevoUsuario`).
 */
export function validarDatosDescuentoEditorial(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (!porcentajeValido(datos['porcentajePorDefecto'])) {
    return { valido: false, error: 'El porcentajePorDefecto debe ser un número entre 0 y 100.' };
  }
  if (!Array.isArray(datos['porcentajesDisponibles']) || !datos['porcentajesDisponibles'].every(porcentajeValido)) {
    return { valido: false, error: 'El porcentajesDisponibles debe ser un array de números entre 0 y 100.' };
  }

  return {
    valido: true,
    datos: {
      porcentajePorDefecto: datos['porcentajePorDefecto'] as number,
      porcentajesDisponibles: datos['porcentajesDisponibles'] as number[],
    },
  };
}

/** Datos aceptados en el body de `POST /api/editoriales-descuentos` — incluye `editorial`, la clave primaria, que no se genera. */
type ResultadoValidacionNueva =
  | { valido: true; datos: DatosDescuentoEditorial & { editorial: string } }
  | { valido: false; error: string };

/**
 * Valida el body de `POST /api/editoriales-descuentos`. Exportada para
 * poder probarla sin invocar el handler completo.
 */
export function validarDatosNuevoDescuentoEditorial(cuerpo: unknown): ResultadoValidacionNueva {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['editorial'] !== 'string' || datos['editorial'].trim() === '') {
    return { valido: false, error: 'La editorial es requerida.' };
  }

  const resto = validarDatosDescuentoEditorial(cuerpo);
  if (!resto.valido) {
    return resto;
  }

  return { valido: true, datos: { editorial: datos['editorial'], ...resto.datos } };
}

/**
 * CRUD `/api/editoriales-descuentos` (tech-specs.md §5, "Admin"): las 4
 * operaciones exigen rol `administrador` exclusivamente. Un solo Lambda
 * para los 4 verbos (ADR-008, mismo patrón que `estantes.ts`/`usuarios.ts`),
 * distinguidos por `event.requestContext.http.method`. `editorial` es la
 * clave primaria de `babel-editoriales-descuentos`, no se genera.
 *
 * `POST` sobre una `editorial` que ya existe responde `409` en vez de
 * sobrescribir en silencio — misma decisión ya tomada para `POST
 * /api/usuarios` (ADR-009), por consistencia.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, {
        error: 'Este correo no está autorizado para administrar descuentos editoriales en Babel.',
      });
    }

    const metodo = event.requestContext.http.method;
    const editorialObjetivo = event.pathParameters?.['editorial'];

    if (metodo === 'GET') {
      const descuentos = await escanearTodo<DescuentoEditorial>(nombreTablaEditorialesDescuentos());
      return respuestaJson(200, descuentos);
    }

    if (metodo === 'POST') {
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosNuevoDescuentoEditorial(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const existente = await obtenerPorClave<DescuentoEditorial>(nombreTablaEditorialesDescuentos(), {
        editorial: validacion.datos.editorial,
      });
      if (existente) {
        return respuestaJson(409, { error: 'Ya existe una configuración de descuento para esa editorial.' });
      }
      const descuento: DescuentoEditorial = { ...validacion.datos };
      await guardar(nombreTablaEditorialesDescuentos(), descuento);
      return respuestaJson(201, descuento);
    }

    if (metodo === 'PUT') {
      if (!editorialObjetivo) {
        return respuestaJson(400, { error: 'Falta la editorial en la ruta.' });
      }
      const existente = await obtenerPorClave<DescuentoEditorial>(nombreTablaEditorialesDescuentos(), {
        editorial: editorialObjetivo,
      });
      if (!existente) {
        return respuestaJson(404, { error: 'No existe una configuración de descuento para esa editorial.' });
      }
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosDescuentoEditorial(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const descuento: DescuentoEditorial = { editorial: editorialObjetivo, ...validacion.datos };
      await guardar(nombreTablaEditorialesDescuentos(), descuento);
      return respuestaJson(200, descuento);
    }

    if (metodo === 'DELETE') {
      if (!editorialObjetivo) {
        return respuestaJson(400, { error: 'Falta la editorial en la ruta.' });
      }
      const existente = await obtenerPorClave<DescuentoEditorial>(nombreTablaEditorialesDescuentos(), {
        editorial: editorialObjetivo,
      });
      if (!existente) {
        return respuestaJson(404, { error: 'No existe una configuración de descuento para esa editorial.' });
      }
      await eliminar(nombreTablaEditorialesDescuentos(), { editorial: editorialObjetivo });
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
