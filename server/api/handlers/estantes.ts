import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { eliminar, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

/**
 * Copia local de `src/app/core/models/estante.model.ts` (misma forma exacta).
 * No se importa directamente por el límite de `rootDir` de
 * `server/tsconfig.json` — ver la misma nota en `usuarios-me.ts`.
 */
interface Estante {
  estanteId: string;
  espacio: string;
  mueble: string;
  ubicacion: string;
}

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que arriba. */
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

function nombreTablaEstantes(): string {
  const nombre = process.env['TABLA_ESTANTES'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_ESTANTES.');
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
 * A01) — a diferencia de `POST /api/libros`, aquí NO basta con `vendedor`.
 * Lanza `TokenInvalidoError` (401) o devuelve `null` (403, sin fila o rol
 * insuficiente) para que el handler que llama decida la respuesta exacta.
 */
async function exigirAdministrador(headerAuthorization: string | undefined): Promise<string | null> {
  const { email } = await verificarTokenDesdeHeader(headerAuthorization);
  const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
  return usuario?.rol === 'administrador' ? email : null;
}

/** Datos aceptados en el body de `POST`/`PUT /api/estantes` — sin `estanteId`, que genera/resuelve el backend. */
interface DatosEstante {
  espacio: string;
  mueble: string;
  ubicacion: string;
}

type ResultadoValidacion = { valido: true; datos: DatosEstante } | { valido: false; error: string };

/**
 * Valida el body de `POST`/`PUT /api/estantes`: los 3 campos de texto son
 * requeridos y no vacíos. Exportada para poder probarla sin invocar el
 * handler completo (mismo patrón que `validarDatosNuevoLibro` en `libros.ts`).
 */
export function validarDatosEstante(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  for (const campo of ['espacio', 'mueble', 'ubicacion'] as const) {
    if (typeof datos[campo] !== 'string' || datos[campo].trim() === '') {
      return { valido: false, error: `El campo "${campo}" es requerido.` };
    }
  }

  return {
    valido: true,
    datos: {
      espacio: datos['espacio'] as string,
      mueble: datos['mueble'] as string,
      ubicacion: datos['ubicacion'] as string,
    },
  };
}

/**
 * CRUD `/api/estantes` (tech-specs.md §5, "Admin"): las 4 operaciones exigen
 * rol `administrador` exclusivamente. Un solo Lambda para los 4 verbos
 * (ADR-008: "grupo pequeño de endpoints muy relacionados") — se distinguen
 * por `event.requestContext.http.method`.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para administrar estantes en Babel.' });
    }

    const metodo = event.requestContext.http.method;
    const estanteId = event.pathParameters?.['estanteId'];

    if (metodo === 'GET') {
      const estantes = await escanearTodo<Estante>(nombreTablaEstantes());
      return respuestaJson(200, estantes);
    }

    if (metodo === 'POST') {
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosEstante(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const estante: Estante = { estanteId: randomUUID(), ...validacion.datos };
      await guardar(nombreTablaEstantes(), estante);
      return respuestaJson(201, estante);
    }

    if (metodo === 'PUT') {
      if (!estanteId) {
        return respuestaJson(400, { error: 'Falta el estanteId en la ruta.' });
      }
      const existente = await obtenerPorClave<Estante>(nombreTablaEstantes(), { estanteId });
      if (!existente) {
        return respuestaJson(404, { error: 'El estante no existe.' });
      }
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosEstante(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const estante: Estante = { estanteId, ...validacion.datos };
      await guardar(nombreTablaEstantes(), estante);
      return respuestaJson(200, estante);
    }

    if (metodo === 'DELETE') {
      if (!estanteId) {
        return respuestaJson(400, { error: 'Falta el estanteId en la ruta.' });
      }
      const existente = await obtenerPorClave<Estante>(nombreTablaEstantes(), { estanteId });
      if (!existente) {
        return respuestaJson(404, { error: 'El estante no existe.' });
      }
      await eliminar(nombreTablaEstantes(), { estanteId });
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
