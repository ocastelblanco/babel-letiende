import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { eliminar, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

/**
 * Modelo jerárquico de ubicación física (`TODO.md` Tarea 2): Espacio →
 * Mueble → Ubicación. Copias locales de `src/app/core/models/espacio.model.ts`,
 * `mueble.model.ts` y `ubicacion.model.ts` (misma forma exacta) — no se
 * importan directamente por el límite de `rootDir` de `server/tsconfig.json`
 * (misma nota que en `estantes.ts`/`usuarios-me.ts`). Este modelo
 * eventualmente reemplazará a `Estante` (`estantes.ts`), que por ahora
 * sigue en uso sin cambios.
 */
interface Espacio {
  espacioId: string;
  nombre: string;
}

interface Mueble {
  muebleId: string;
  espacioId: string;
  nombre: string;
}

interface Ubicacion {
  ubicacionId: string;
  muebleId: string;
  nombre: string;
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

function nombreTablaEspacios(): string {
  const nombre = process.env['TABLA_ESPACIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_ESPACIOS.');
  }
  return nombre;
}

function nombreTablaMuebles(): string {
  const nombre = process.env['TABLA_MUEBLES'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_MUEBLES.');
  }
  return nombre;
}

function nombreTablaUbicaciones(): string {
  const nombre = process.env['TABLA_UBICACIONES'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_UBICACIONES.');
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
 * Verifica el ID Token y exige rol `administrador` exclusivamente
 * (CLAUDE.md A01) — usado por `POST`/`PUT`/`DELETE` de las 3 entidades, que
 * modifican el modelo de ubicación física. `GET` es público, sin token
 * (a diferencia de `estantes.ts`), así que nunca llama esta función. Lanza
 * `TokenInvalidoError` (401) o devuelve `null` (403, sin fila o rol
 * insuficiente) para que el handler que llama decida la respuesta exacta.
 */
async function exigirAdministrador(headerAuthorization: string | undefined): Promise<string | null> {
  const { email } = await verificarTokenDesdeHeader(headerAuthorization);
  const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
  return usuario?.rol === 'administrador' ? email : null;
}

/** Datos aceptados en el body de `POST`/`PUT /api/espacios` — sin `espacioId`, que genera/resuelve el backend. */
interface DatosEspacio {
  nombre: string;
}

type ResultadoValidacionEspacio = { valido: true; datos: DatosEspacio } | { valido: false; error: string };

/** Valida el body de `POST`/`PUT /api/espacios`: `nombre` es requerido y no vacío. */
export function validarDatosEspacio(cuerpo: unknown): ResultadoValidacionEspacio {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['nombre'] !== 'string' || datos['nombre'].trim() === '') {
    return { valido: false, error: 'El campo "nombre" es requerido.' };
  }

  return { valido: true, datos: { nombre: datos['nombre'] } };
}

/** Datos aceptados en el body de `POST`/`PUT /api/muebles` — sin `muebleId`, que genera/resuelve el backend. */
interface DatosMueble {
  nombre: string;
  espacioId: string;
}

type ResultadoValidacionMueble = { valido: true; datos: DatosMueble } | { valido: false; error: string };

/** Valida el body de `POST`/`PUT /api/muebles`: `nombre` y `espacioId` son requeridos y no vacíos (la existencia de `espacioId` se valida aparte contra `babel-espacios`). */
export function validarDatosMueble(cuerpo: unknown): ResultadoValidacionMueble {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['nombre'] !== 'string' || datos['nombre'].trim() === '') {
    return { valido: false, error: 'El campo "nombre" es requerido.' };
  }
  if (typeof datos['espacioId'] !== 'string' || datos['espacioId'].trim() === '') {
    return { valido: false, error: 'El campo "espacioId" es requerido.' };
  }

  return { valido: true, datos: { nombre: datos['nombre'], espacioId: datos['espacioId'] } };
}

/** Datos aceptados en el body de `POST`/`PUT /api/ubicaciones` — sin `ubicacionId`, que genera/resuelve el backend. */
interface DatosUbicacion {
  nombre: string;
  muebleId: string;
}

type ResultadoValidacionUbicacion = { valido: true; datos: DatosUbicacion } | { valido: false; error: string };

/** Valida el body de `POST`/`PUT /api/ubicaciones`: `nombre` y `muebleId` son requeridos y no vacíos (la existencia de `muebleId` se valida aparte contra `babel-muebles`). */
export function validarDatosUbicacion(cuerpo: unknown): ResultadoValidacionUbicacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['nombre'] !== 'string' || datos['nombre'].trim() === '') {
    return { valido: false, error: 'El campo "nombre" es requerido.' };
  }
  if (typeof datos['muebleId'] !== 'string' || datos['muebleId'].trim() === '') {
    return { valido: false, error: 'El campo "muebleId" es requerido.' };
  }

  return { valido: true, datos: { nombre: datos['nombre'], muebleId: datos['muebleId'] } };
}

function parsearCuerpo(body: string | undefined): { valido: true; cuerpo: unknown } | { valido: false } {
  try {
    return { valido: true, cuerpo: body ? JSON.parse(body) : undefined };
  } catch {
    return { valido: false };
  }
}

/**
 * CRUD `/api/espacios` — primer nivel del modelo jerárquico de ubicación
 * física (`TODO.md` Tarea 2). `GET` es público (sin token): el catálogo
 * público necesitará leer Espacios/Muebles en una tarea futura para armar
 * un filtro. `POST`/`PUT`/`DELETE` exigen `administrador` exclusivamente
 * (CLAUDE.md A01). Un `DELETE` se rechaza con `400` si algún `Mueble`
 * todavía referencia el espacio, para no dejar datos huérfanos.
 */
export const handlerEspacios: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const metodo = event.requestContext.http.method;
    const espacioId = event.pathParameters?.['espacioId'];

    if (metodo === 'GET') {
      const espacios = await escanearTodo<Espacio>(nombreTablaEspacios());
      return respuestaJson(200, espacios);
    }

    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para administrar espacios en Babel.' });
    }

    if (metodo === 'POST') {
      const parseo = parsearCuerpo(event.body);
      if (!parseo.valido) {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosEspacio(parseo.cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const espacio: Espacio = { espacioId: randomUUID(), ...validacion.datos };
      await guardar(nombreTablaEspacios(), espacio);
      return respuestaJson(201, espacio);
    }

    if (metodo === 'PUT') {
      if (!espacioId) {
        return respuestaJson(400, { error: 'Falta el espacioId en la ruta.' });
      }
      const existente = await obtenerPorClave<Espacio>(nombreTablaEspacios(), { espacioId });
      if (!existente) {
        return respuestaJson(404, { error: 'El espacio no existe.' });
      }
      const parseo = parsearCuerpo(event.body);
      if (!parseo.valido) {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosEspacio(parseo.cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const espacio: Espacio = { espacioId, ...validacion.datos };
      await guardar(nombreTablaEspacios(), espacio);
      return respuestaJson(200, espacio);
    }

    if (metodo === 'DELETE') {
      if (!espacioId) {
        return respuestaJson(400, { error: 'Falta el espacioId en la ruta.' });
      }
      const existente = await obtenerPorClave<Espacio>(nombreTablaEspacios(), { espacioId });
      if (!existente) {
        return respuestaJson(404, { error: 'El espacio no existe.' });
      }
      const muebles = await escanearTodo<Mueble>(nombreTablaMuebles());
      if (muebles.some((mueble) => mueble.espacioId === espacioId)) {
        return respuestaJson(400, { error: 'No se puede eliminar un espacio que tiene muebles asociados.' });
      }
      await eliminar(nombreTablaEspacios(), { espacioId });
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

/**
 * CRUD `/api/muebles` — segundo nivel del modelo jerárquico de ubicación
 * física (`TODO.md` Tarea 2). `GET` es público (sin token), mismo criterio
 * que `handlerEspacios`. `POST`/`PUT` validan que `espacioId` exista en
 * `babel-espacios` antes de guardar (`400` si no existe). `DELETE` se
 * rechaza con `400` si alguna `Ubicacion` todavía referencia el mueble.
 */
export const handlerMuebles: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const metodo = event.requestContext.http.method;
    const muebleId = event.pathParameters?.['muebleId'];

    if (metodo === 'GET') {
      const muebles = await escanearTodo<Mueble>(nombreTablaMuebles());
      return respuestaJson(200, muebles);
    }

    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para administrar muebles en Babel.' });
    }

    if (metodo === 'POST') {
      const parseo = parsearCuerpo(event.body);
      if (!parseo.valido) {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosMueble(parseo.cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const espacio = await obtenerPorClave<Espacio>(nombreTablaEspacios(), { espacioId: validacion.datos.espacioId });
      if (!espacio) {
        return respuestaJson(400, { error: 'El espacio indicado no existe.' });
      }
      const mueble: Mueble = { muebleId: randomUUID(), ...validacion.datos };
      await guardar(nombreTablaMuebles(), mueble);
      return respuestaJson(201, mueble);
    }

    if (metodo === 'PUT') {
      if (!muebleId) {
        return respuestaJson(400, { error: 'Falta el muebleId en la ruta.' });
      }
      const existente = await obtenerPorClave<Mueble>(nombreTablaMuebles(), { muebleId });
      if (!existente) {
        return respuestaJson(404, { error: 'El mueble no existe.' });
      }
      const parseo = parsearCuerpo(event.body);
      if (!parseo.valido) {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosMueble(parseo.cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const espacio = await obtenerPorClave<Espacio>(nombreTablaEspacios(), { espacioId: validacion.datos.espacioId });
      if (!espacio) {
        return respuestaJson(400, { error: 'El espacio indicado no existe.' });
      }
      const mueble: Mueble = { muebleId, ...validacion.datos };
      await guardar(nombreTablaMuebles(), mueble);
      return respuestaJson(200, mueble);
    }

    if (metodo === 'DELETE') {
      if (!muebleId) {
        return respuestaJson(400, { error: 'Falta el muebleId en la ruta.' });
      }
      const existente = await obtenerPorClave<Mueble>(nombreTablaMuebles(), { muebleId });
      if (!existente) {
        return respuestaJson(404, { error: 'El mueble no existe.' });
      }
      const ubicaciones = await escanearTodo<Ubicacion>(nombreTablaUbicaciones());
      if (ubicaciones.some((ubicacion) => ubicacion.muebleId === muebleId)) {
        return respuestaJson(400, { error: 'No se puede eliminar un mueble que tiene ubicaciones asociadas.' });
      }
      await eliminar(nombreTablaMuebles(), { muebleId });
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

/**
 * CRUD `/api/ubicaciones` — tercer nivel del modelo jerárquico de
 * ubicación física (`TODO.md` Tarea 2). `GET` es público (sin token),
 * mismo criterio que `handlerEspacios`/`handlerMuebles`. `POST`/`PUT`
 * validan que `muebleId` exista en `babel-muebles` antes de guardar (`400`
 * si no existe). `DELETE` no tiene restricciones adicionales por ahora:
 * ningún `Libro` referencia todavía una `Ubicacion` (eso es tarea futura).
 */
export const handlerUbicaciones: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const metodo = event.requestContext.http.method;
    const ubicacionId = event.pathParameters?.['ubicacionId'];

    if (metodo === 'GET') {
      const ubicaciones = await escanearTodo<Ubicacion>(nombreTablaUbicaciones());
      return respuestaJson(200, ubicaciones);
    }

    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para administrar ubicaciones en Babel.' });
    }

    if (metodo === 'POST') {
      const parseo = parsearCuerpo(event.body);
      if (!parseo.valido) {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosUbicacion(parseo.cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const mueble = await obtenerPorClave<Mueble>(nombreTablaMuebles(), { muebleId: validacion.datos.muebleId });
      if (!mueble) {
        return respuestaJson(400, { error: 'El mueble indicado no existe.' });
      }
      const ubicacion: Ubicacion = { ubicacionId: randomUUID(), ...validacion.datos };
      await guardar(nombreTablaUbicaciones(), ubicacion);
      return respuestaJson(201, ubicacion);
    }

    if (metodo === 'PUT') {
      if (!ubicacionId) {
        return respuestaJson(400, { error: 'Falta el ubicacionId en la ruta.' });
      }
      const existente = await obtenerPorClave<Ubicacion>(nombreTablaUbicaciones(), { ubicacionId });
      if (!existente) {
        return respuestaJson(404, { error: 'La ubicación no existe.' });
      }
      const parseo = parsearCuerpo(event.body);
      if (!parseo.valido) {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosUbicacion(parseo.cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const mueble = await obtenerPorClave<Mueble>(nombreTablaMuebles(), { muebleId: validacion.datos.muebleId });
      if (!mueble) {
        return respuestaJson(400, { error: 'El mueble indicado no existe.' });
      }
      const ubicacion: Ubicacion = { ubicacionId, ...validacion.datos };
      await guardar(nombreTablaUbicaciones(), ubicacion);
      return respuestaJson(200, ubicacion);
    }

    if (metodo === 'DELETE') {
      if (!ubicacionId) {
        return respuestaJson(400, { error: 'Falta el ubicacionId en la ruta.' });
      }
      const existente = await obtenerPorClave<Ubicacion>(nombreTablaUbicaciones(), { ubicacionId });
      if (!existente) {
        return respuestaJson(404, { error: 'La ubicación no existe.' });
      }
      await eliminar(nombreTablaUbicaciones(), { ubicacionId });
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
