import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { escanearMayorQue, guardar, obtenerPorClave } from '../services/dynamodb';

/**
 * Copia local de `src/app/core/models/libro.model.ts` (misma forma exacta).
 * No se importa directamente por el límite de `rootDir` de
 * `server/tsconfig.json` — ver la misma nota en `usuarios-me.ts`.
 */
interface Libro {
  isbn: string | null;
  bookId: string;
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  pvp: number;
  porcentajeDescuentoEditorial: number;
  costo: number;
  utilidadCatalogo: number;
  cantidadTotal: number;
  cantidadDisponible: number;
  estanteId: string;
  creadoPor: string;
  creadoEn: string;
  actualizadoEn: string;
}

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que arriba. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}

/** Copia local de `src/app/core/models/estante.model.ts` — mismo motivo que arriba. */
interface Estante {
  estanteId: string;
  espacio: string;
  mueble: string;
  ubicacion: string;
}

function respuestaJson(statusCode: number, cuerpo: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

function nombreTablaLibros(): string {
  const nombre = process.env['TABLA_LIBROS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_LIBROS.');
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

function nombreTablaEstantes(): string {
  const nombre = process.env['TABLA_ESTANTES'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_ESTANTES.');
  }
  return nombre;
}

/**
 * `GET /api/libros` — catálogo público de consulta (tech-specs.md §5,
 * endpoint marcado "Pública"): sin autenticación, solo libros con al menos
 * un ejemplar disponible. Los filtros por texto/autor/tema quedan para una
 * tarea posterior (por ahora devuelve el catálogo completo disponible).
 */
export const handler: APIGatewayProxyHandlerV2 = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const libros = await escanearMayorQue<Libro>(
      nombreTablaLibros(),
      'cantidadDisponible',
      0,
    );
    return respuestaJson(200, libros);
  } catch {
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/** Datos del libro que expone `handlerDetalle`, con la ubicación física ya resuelta (`TODO.md`, ficha de libro). */
interface LibroConEstante extends Libro {
  /** `null` si el estante referenciado ya no existe (dato inconsistente, pero no debe romper la ficha) — CLAUDE.md A08. */
  estante: { espacio: string; mueble: string; ubicacion: string } | null;
}

/**
 * `GET /api/libros/:bookId` — ficha pública de un libro puntual
 * (`tech-specs.md`, módulo `catalogo-publico/`; `TODO.md`, ficha de libro).
 * Sin autenticación, mismo criterio que `GET /api/libros`: es de solo
 * lectura, sin datos sensibles. A diferencia del listado, NO filtra por
 * `cantidadDisponible` — un visitante que llega por un enlace directo o un
 * resultado de buscador debe poder ver la ficha aunque el libro esté
 * agotado en este momento.
 *
 * Resuelve la ubicación física (`PRD.md` §7, "Ve el PVP y la ubicación
 * física... si está disponible") consultando `babel-estantes` por el
 * `estanteId` del libro — un `GetItem` puntual adicional, no un `Scan`. Si
 * el estante ya no existe (dato inconsistente), `estante` queda en `null`
 * en vez de romper la respuesta.
 */
export const handlerDetalle: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const bookId = event.pathParameters?.['bookId'];
    if (!bookId) {
      return respuestaJson(400, { error: 'Falta el bookId en la ruta.' });
    }

    const libro = await obtenerPorClave<Libro>(nombreTablaLibros(), { bookId });
    if (!libro) {
      return respuestaJson(404, { error: 'El libro no existe.' });
    }

    const estante = await obtenerPorClave<Estante>(nombreTablaEstantes(), { estanteId: libro.estanteId });

    const libroConEstante: LibroConEstante = {
      ...libro,
      estante: estante ? { espacio: estante.espacio, mueble: estante.mueble, ubicacion: estante.ubicacion } : null,
    };

    return respuestaJson(200, libroConEstante);
  } catch {
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/** Datos aceptados en el body de `POST /api/libros` — el resto lo genera el backend (ver `handlerCrear`). */
interface DatosNuevoLibro {
  isbn: string | null;
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  pvp: number;
  porcentajeDescuentoEditorial: number;
  cantidadTotal: number;
  estanteId: string;
}

/** Techo de sanidad para el PVP (CLAUDE.md A08) — no es un límite de negocio real, solo detecta datos claramente erróneos. */
const PVP_MAXIMO = 5_000_000;

type ResultadoValidacion =
  | { valido: true; datos: DatosNuevoLibro }
  | { valido: false; error: string };

/**
 * Valida el body de `POST /api/libros` (CLAUDE.md A08: el PVP en esta tarea
 * lo ingresa manualmente el vendedor —la resolución automática por ISBN es
 * una tarea futura— pero el backend igual valida que sea un número positivo
 * dentro de un rango razonable antes de guardarlo). Exportada para poder
 * probarla sin invocar el handler completo.
 */
export function validarDatosNuevoLibro(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['titulo'] !== 'string' || datos['titulo'].trim() === '') {
    return { valido: false, error: 'El título es requerido.' };
  }
  if (typeof datos['autor'] !== 'string' || datos['autor'].trim() === '') {
    return { valido: false, error: 'El autor es requerido.' };
  }
  if (typeof datos['estanteId'] !== 'string' || datos['estanteId'].trim() === '') {
    return { valido: false, error: 'El estante es requerido.' };
  }
  if (
    typeof datos['pvp'] !== 'number' ||
    !Number.isFinite(datos['pvp']) ||
    datos['pvp'] <= 0 ||
    datos['pvp'] > PVP_MAXIMO
  ) {
    return { valido: false, error: `El PVP debe ser un número mayor a 0 y menor o igual a ${PVP_MAXIMO}.` };
  }
  if (
    typeof datos['porcentajeDescuentoEditorial'] !== 'number' ||
    !Number.isFinite(datos['porcentajeDescuentoEditorial']) ||
    datos['porcentajeDescuentoEditorial'] < 0 ||
    datos['porcentajeDescuentoEditorial'] > 100
  ) {
    return { valido: false, error: 'El porcentaje de descuento editorial debe estar entre 0 y 100.' };
  }
  if (
    typeof datos['cantidadTotal'] !== 'number' ||
    !Number.isInteger(datos['cantidadTotal']) ||
    datos['cantidadTotal'] <= 0
  ) {
    return { valido: false, error: 'La cantidad total debe ser un número entero mayor a 0.' };
  }

  const isbn = typeof datos['isbn'] === 'string' && datos['isbn'].trim() !== '' ? datos['isbn'] : null;
  const editorial =
    typeof datos['editorial'] === 'string' && datos['editorial'].trim() !== '' ? datos['editorial'] : null;
  const portadaUrl =
    typeof datos['portadaUrl'] === 'string' && datos['portadaUrl'].trim() !== '' ? datos['portadaUrl'] : null;

  return {
    valido: true,
    datos: {
      isbn,
      titulo: datos['titulo'],
      autor: datos['autor'],
      editorial,
      portadaUrl,
      pvp: datos['pvp'],
      porcentajeDescuentoEditorial: datos['porcentajeDescuentoEditorial'],
      cantidadTotal: datos['cantidadTotal'],
      estanteId: datos['estanteId'],
    },
  };
}

/**
 * `POST /api/libros` — cataloga un libro (tech-specs.md §5, "Vendedor/Admin").
 * Exige rol `vendedor` o `administrador` en `babel-usuarios` (CLAUDE.md A01)
 * — nunca confía en un rol enviado desde el cliente. `creadoPor` se toma
 * siempre del email verificado del token, nunca del body.
 */
export const handlerCrear: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para catalogar libros en Babel.' });
    }

    let cuerpo: unknown;
    try {
      cuerpo = event.body ? JSON.parse(event.body) : undefined;
    } catch {
      return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
    }

    const validacion = validarDatosNuevoLibro(cuerpo);
    if (!validacion.valido) {
      return respuestaJson(400, { error: validacion.error });
    }

    const { datos } = validacion;
    const ahora = new Date().toISOString();
    const libro: Libro = {
      ...datos,
      bookId: randomUUID(),
      costo: Math.round(datos.pvp * (1 - datos.porcentajeDescuentoEditorial / 100)),
      utilidadCatalogo: Math.round(datos.pvp * (datos.porcentajeDescuentoEditorial / 100)),
      cantidadDisponible: datos.cantidadTotal,
      creadoPor: email,
      creadoEn: ahora,
      actualizadoEn: ahora,
    };

    await guardar(nombreTablaLibros(), libro);

    return respuestaJson(201, libro);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * `PATCH /api/libros/:bookId/estante` — cambia el estante de un libro ya
 * catalogado (tech-specs.md §5, "Vendedor/Admin"). Exige rol `vendedor` o
 * `administrador` (CLAUDE.md A01), mismo criterio que `POST /api/libros` —
 * mover un libro de estante es parte de la operación diaria, no solo de
 * administración. La ruta usa `bookId` (clave primaria real de
 * `babel-libros`, tech-specs.md §5.1) y no `isbn`, que puede ser `null`.
 */
export const handlerCambiarEstante: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para catalogar libros en Babel.' });
    }

    const bookId = event.pathParameters?.['bookId'];
    if (!bookId) {
      return respuestaJson(400, { error: 'Falta el bookId en la ruta.' });
    }

    const libro = await obtenerPorClave<Libro>(nombreTablaLibros(), { bookId });
    if (!libro) {
      return respuestaJson(404, { error: 'El libro no existe.' });
    }

    let cuerpo: unknown;
    try {
      cuerpo = event.body ? JSON.parse(event.body) : undefined;
    } catch {
      return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
    }
    const datos = typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>) : {};
    if (typeof datos['estanteId'] !== 'string' || datos['estanteId'].trim() === '') {
      return respuestaJson(400, { error: 'El estanteId es requerido.' });
    }
    const estanteId = datos['estanteId'];

    const estante = await obtenerPorClave<Estante>(nombreTablaEstantes(), { estanteId });
    if (!estante) {
      return respuestaJson(400, { error: 'El estante indicado no existe.' });
    }

    const libroActualizado: Libro = { ...libro, estanteId, actualizadoEn: new Date().toISOString() };
    await guardar(nombreTablaLibros(), libroActualizado);

    return respuestaJson(200, libroActualizado);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
