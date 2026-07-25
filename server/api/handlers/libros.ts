import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import * as XLSX from 'xlsx';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { eliminar, escanearMayorQue, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

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
  ubicacionId: string;
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

/**
 * Copias locales de `src/app/core/models/espacio.model.ts`,
 * `mueble.model.ts` y `ubicacion.model.ts` — mismo motivo que arriba.
 * Modelo jerárquico Espacio → Mueble → Ubicación (`TODO.md` Tarea 1, PR #54)
 * que reemplaza al antiguo `Estante`.
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
interface LibroConUbicacion extends Libro {
  /** `null` si algún eslabón de la cadena Ubicación → Mueble → Espacio ya no existe (dato inconsistente, pero no debe romper la ficha) — CLAUDE.md A08. */
  ubicacion: { espacio: string; mueble: string; ubicacion: string } | null;
}

/**
 * Resuelve el nombre de Espacio/Mueble/Ubicación de un libro con 3 `GetItem`
 * puntuales (no un `Scan`): `ubicacionId` → `Ubicacion` → `Mueble` →
 * `Espacio`. Si cualquier eslabón de la cadena ya no existe (dato
 * inconsistente — ej. la ubicación fue borrada pero el libro todavía la
 * referencia), devuelve `null` en vez de lanzar (CLAUDE.md A08). También
 * cubre los libros catalogados antes de la migración `estanteId`→`ubicacionId`
 * (`TODO.md` Tarea 1): para esos, `ubicacionId` es `undefined`, y llamar a
 * DynamoDB con una clave `undefined` lanzaría una excepción de validación.
 */
async function resolverUbicacion(
  ubicacionId: string | undefined,
): Promise<{ espacio: string; mueble: string; ubicacion: string } | null> {
  if (!ubicacionId) {
    return null;
  }
  const ubicacion = await obtenerPorClave<Ubicacion>(nombreTablaUbicaciones(), { ubicacionId });
  if (!ubicacion) {
    return null;
  }
  const mueble = await obtenerPorClave<Mueble>(nombreTablaMuebles(), { muebleId: ubicacion.muebleId });
  if (!mueble) {
    return null;
  }
  const espacio = await obtenerPorClave<Espacio>(nombreTablaEspacios(), { espacioId: mueble.espacioId });
  if (!espacio) {
    return null;
  }
  return { espacio: espacio.nombre, mueble: mueble.nombre, ubicacion: ubicacion.nombre };
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
 * física... si está disponible") con `resolverUbicacion` (Espacio → Mueble →
 * Ubicación, `TODO.md` Tarea 1) — 3 `GetItem` puntuales, no un `Scan`. Si
 * algún eslabón ya no existe (dato inconsistente), `ubicacion` queda en
 * `null` en vez de romper la respuesta.
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

    const ubicacion = await resolverUbicacion(libro.ubicacionId);

    const libroConUbicacion: LibroConUbicacion = { ...libro, ubicacion };

    return respuestaJson(200, libroConUbicacion);
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
  ubicacionId: string;
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
  if (typeof datos['ubicacionId'] !== 'string' || datos['ubicacionId'].trim() === '') {
    return { valido: false, error: 'La ubicación es requerida.' };
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
      ubicacionId: datos['ubicacionId'],
    },
  };
}

/**
 * `POST /api/libros` — cataloga un libro (tech-specs.md §5, "Vendedor/Admin").
 * Exige rol `vendedor` o `administrador` en `babel-usuarios` (CLAUDE.md A01)
 * — nunca confía en un rol enviado desde el cliente. `creadoPor` se toma
 * siempre del email verificado del token, nunca del body. Valida que el
 * `ubicacionId` recibido exista en `babel-ubicaciones` antes de guardar
 * (mismo criterio que `handlerMuebles`/`handlerUbicaciones` en
 * `ubicacion-fisica.ts` validan a su padre, `TODO.md` Tarea 1).
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

    const ubicacion = await obtenerPorClave<Ubicacion>(nombreTablaUbicaciones(), { ubicacionId: datos.ubicacionId });
    if (!ubicacion) {
      return respuestaJson(400, { error: 'La ubicación indicada no existe.' });
    }

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

/** Datos aceptados en el body de `PUT /api/libros/:bookId` — solo los 4 campos editables desde la pestaña "Editar" del área "Gestionar" (`TODO.md`). */
interface DatosEditarLibro {
  ubicacionId: string;
  cantidadTotal: number;
  pvp: number;
  porcentajeDescuentoEditorial: number;
}

type ResultadoValidacionEditar =
  | { valido: true; datos: DatosEditarLibro }
  | { valido: false; error: string };

/**
 * Valida el body de `PUT /api/libros/:bookId`: mismas reglas de rango que
 * `validarDatosNuevoLibro` para `pvp`/`porcentajeDescuentoEditorial`, salvo
 * `cantidadTotal`, que aquí acepta 0 (a diferencia de la catalogación
 * inicial) — el área "Gestionar" permite bajar la cantidad de un libro
 * hasta 0 sin eliminarlo (`TODO.md`). Exportada para poder probarla sin
 * invocar el handler completo.
 */
export function validarDatosEditarLibro(cuerpo: unknown): ResultadoValidacionEditar {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['ubicacionId'] !== 'string' || datos['ubicacionId'].trim() === '') {
    return { valido: false, error: 'La ubicación es requerida.' };
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
    datos['cantidadTotal'] < 0
  ) {
    return { valido: false, error: 'La cantidad total debe ser un número entero mayor o igual a 0.' };
  }

  return {
    valido: true,
    datos: {
      ubicacionId: datos['ubicacionId'],
      cantidadTotal: datos['cantidadTotal'],
      pvp: datos['pvp'],
      porcentajeDescuentoEditorial: datos['porcentajeDescuentoEditorial'],
    },
  };
}

/**
 * `PUT /api/libros/:bookId` — edita un libro ya catalogado (`TODO.md`, área
 * "Gestionar", pestaña "Editar"). Exige rol `vendedor` o `administrador`
 * (CLAUDE.md A01), mismo criterio que `POST /api/libros`. Reemplaza a
 * `handlerCambiarUbicacion` (que solo cambiaba `ubicacionId`): ahora también
 * permite corregir `cantidadTotal` (incluida una baja hasta 0), `pvp` y
 * `porcentajeDescuentoEditorial`.
 *
 * Al cambiar `cantidadTotal`, `cantidadDisponible` se ajusta por la misma
 * diferencia (delta) en vez de reemplazarse — así se preserva cuántos
 * ejemplares ya se vendieron (`cantidadTotal - cantidadDisponible` antes de
 * editar), sin importar si el vendedor corrige el total hacia arriba o hacia
 * abajo. El resultado se recorta a `[0, nuevaCantidadTotal]` para nunca
 * quedar negativo ni por encima del nuevo total (ej. si la cantidadTotal
 * baja por debajo de lo ya vendido).
 *
 * `costo`/`utilidadCatalogo` se recalculan siempre con el mismo criterio que
 * `handlerCrear` (a partir de `pvp`/`porcentajeDescuentoEditorial`), nunca
 * se reciben del cliente (CLAUDE.md A08).
 */
export const handlerEditar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para editar libros en Babel.' });
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

    const validacion = validarDatosEditarLibro(cuerpo);
    if (!validacion.valido) {
      return respuestaJson(400, { error: validacion.error });
    }
    const { datos } = validacion;

    const ubicacion = await obtenerPorClave<Ubicacion>(nombreTablaUbicaciones(), { ubicacionId: datos.ubicacionId });
    if (!ubicacion) {
      return respuestaJson(400, { error: 'La ubicación indicada no existe.' });
    }

    const deltaCantidad = datos.cantidadTotal - libro.cantidadTotal;
    const cantidadDisponible = Math.min(Math.max(libro.cantidadDisponible + deltaCantidad, 0), datos.cantidadTotal);

    const libroActualizado: Libro = {
      ...libro,
      ubicacionId: datos.ubicacionId,
      cantidadTotal: datos.cantidadTotal,
      cantidadDisponible,
      pvp: datos.pvp,
      porcentajeDescuentoEditorial: datos.porcentajeDescuentoEditorial,
      costo: Math.round(datos.pvp * (1 - datos.porcentajeDescuentoEditorial / 100)),
      utilidadCatalogo: Math.round(datos.pvp * (datos.porcentajeDescuentoEditorial / 100)),
      actualizadoEn: new Date().toISOString(),
    };

    await guardar(nombreTablaLibros(), libroActualizado);

    return respuestaJson(200, libroActualizado);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * `DELETE /api/libros/:bookId` — elimina un libro catalogado (`TODO.md`,
 * área "Gestionar", pestaña "Editar", botón "ELIMINAR LIBRO"). Exige rol
 * `administrador` EXCLUSIVAMENTE (a diferencia de `PUT`, que acepta también
 * `vendedor`) — mismo criterio de otros CRUD de administración (CLAUDE.md
 * A01, ADR-008). Solo valida que el `bookId` exista.
 */
export const handlerEliminar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para eliminar libros en Babel.' });
    }

    const bookId = event.pathParameters?.['bookId'];
    if (!bookId) {
      return respuestaJson(400, { error: 'Falta el bookId en la ruta.' });
    }

    const libro = await obtenerPorClave<Libro>(nombreTablaLibros(), { bookId });
    if (!libro) {
      return respuestaJson(404, { error: 'El libro no existe.' });
    }

    await eliminar(nombreTablaLibros(), { bookId });

    return respuestaJson(204, undefined);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * `GET /api/libros/inventario` — listado COMPLETO de libros catalogados,
 * incluidos los agotados (`cantidadDisponible = 0`) — a diferencia de
 * `GET /api/libros` (catálogo público, solo libros disponibles). Exige rol
 * `vendedor` o `administrador` (CLAUDE.md A01): es la pantalla de
 * inventario de la pestaña "Editar" del área "Gestionar", no el catálogo
 * público. Ruta estática `/api/libros/inventario`, sin conflicto con
 * `/api/libros/:bookId` — API Gateway (HTTP API) prioriza siempre los
 * segmentos de ruta literales sobre los parametrizados, mismo criterio ya
 * usado por `/api/usuarios/me` frente a `/api/usuarios/{email}`.
 */
export const handlerInventario: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para ver el inventario de Babel.' });
    }

    const libros = await escanearTodo<Libro>(nombreTablaLibros());
    return respuestaJson(200, libros);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * `GET /api/libros/exportar` — genera un archivo `.xlsx` con el inventario
 * completo de libros (`ajustes-finales.md` Tarea G, `TODO.md` Tarea 1),
 * junto al reporte de ventas ya existente en `/admin/reportes`. Exige rol
 * `administrador` EXCLUSIVAMENTE (mismo criterio que
 * `GET /api/ventas/exportar`: información de negocio sensible — costo y
 * volumen de inventario). Ruta estática, sin conflicto con
 * `/api/libros/{bookId}` (mismo criterio que `/api/libros/inventario`).
 *
 * Resuelve Espacio/Mueble/Ubicación por libro con 3 `escanearTodo` en
 * paralelo (uno por tabla) en vez de reutilizar `resolverUbicacion` por
 * cada libro (que haría 3 `GetItem` por fila) — a este volumen (miles de
 * libros, pero solo decenas de ubicaciones distintas) es más barato cargar
 * las 3 tablas de ubicación una sola vez y resolver cada libro con 3
 * `Map.get()` en memoria.
 *
 * `Cantidad` reporta `cantidadDisponible` (no `cantidadTotal`): un reporte
 * de inventario existe para conciliar contra el conteo físico en el
 * estante, y `cantidadDisponible` es lo que debería quedar físicamente
 * presente (`cantidadTotal` incluye ejemplares ya vendidos).
 */
export const handlerExportarInventario: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para exportar el inventario en Babel.' });
    }

    const [libros, ubicaciones, muebles, espacios] = await Promise.all([
      escanearTodo<Libro>(nombreTablaLibros()),
      escanearTodo<Ubicacion>(nombreTablaUbicaciones()),
      escanearTodo<Mueble>(nombreTablaMuebles()),
      escanearTodo<Espacio>(nombreTablaEspacios()),
    ]);

    const ubicacionPorId = new Map(ubicaciones.map((ubicacion) => [ubicacion.ubicacionId, ubicacion]));
    const mueblePorId = new Map(muebles.map((mueble) => [mueble.muebleId, mueble]));
    const espacioPorId = new Map(espacios.map((espacio) => [espacio.espacioId, espacio]));

    const filas = libros.map((libro) => {
      const ubicacion = ubicacionPorId.get(libro.ubicacionId);
      const mueble = ubicacion ? mueblePorId.get(ubicacion.muebleId) : undefined;
      const espacio = mueble ? espacioPorId.get(mueble.espacioId) : undefined;
      return {
        ISBN: libro.isbn ?? '—',
        Título: libro.titulo,
        Autor: libro.autor,
        Editorial: libro.editorial ?? '—',
        PVP: libro.pvp,
        'Descuento editorial (%)': libro.porcentajeDescuentoEditorial,
        Cantidad: libro.cantidadDisponible,
        Espacio: espacio?.nombre ?? '—',
        Mueble: mueble?.nombre ?? '—',
        Ubicación: ubicacion?.nombre ?? '—',
      };
    });

    const libroExcel = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(filas);
    XLSX.utils.book_append_sheet(libroExcel, hoja, 'Inventario');
    const contenidoBase64 = XLSX.write(libroExcel, { type: 'base64', bookType: 'xlsx' }) as string;

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="reporte-inventario.xlsx"',
      },
      body: contenidoBase64,
    };
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
