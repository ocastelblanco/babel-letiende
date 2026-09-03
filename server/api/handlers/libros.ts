import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import * as XLSX from 'xlsx';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import {
  consultarPorIndice,
  eliminar,
  escanearMayorQue,
  escanearProyeccion,
  escanearTodo,
  fusionarLibroDuplicado,
  guardar,
  ItemNoExisteError,
  obtenerPorClave,
  omitirCamposNulos,
} from '../services/dynamodb';

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

/**
 * Restituye el `isbn: null` que el contrato `Libro` promete al frontend.
 *
 * Un libro sin ISBN se persiste con el atributo AUSENTE en `babel-libros`
 * (`omitirCamposNulos`, porque el GSI disperso `isbn-index` tipa `isbn`
 * estrictamente `S` y rechazaría un `null`), así que todo ítem que vuelva
 * crudo de un `Scan`/`GetItem`/`Query` llega sin la clave `isbn` — es decir,
 * `undefined` en el JSON de la respuesta, no `null` como declara
 * `Libro.isbn: string | null`. Esa discrepancia entre lo que el tipo promete
 * y lo que el JSON entrega tumbó el buscador de la pestaña "Editar" en
 * producción (2026-08-29): un `libro.isbn !== null` en el cliente dejaba
 * pasar el `undefined` y reventaba el `computed` del filtro. Todo handler que
 * devuelva libros leídos de la tabla pasa por aquí; los que construyen el
 * objeto en memoria (`handlerCrear`/`handlerEditar`) ya traen `isbn`
 * explícito y no lo necesitan.
 */
function normalizarLibro<T extends Libro>(libro: T): T {
  return { ...libro, isbn: libro.isbn ?? null };
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
    return respuestaJson(200, libros.map(normalizarLibro));
  } catch {
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

const BASE_URL_PUBLICA = 'https://letiende.co/libros';

/** Neutraliza los 5 caracteres reservados de XML (mismo criterio que el escape de JSON-LD de CLAUDE.md §5, A03, aplicado aquí a XML). */
function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * `GET /sitemap.xml` — Babel no tenía sitemap propio (T-0014, mapa del
 * sitio del catálogo público, mismo patrón ya validado en el proyecto
 * hermano Ágora, T-0013). Reutiliza la misma consulta que `handler` (el
 * catálogo público en sí): solo libros con al menos un ejemplar disponible
 * — no tiene sentido indexar un libro agotado que ni siquiera aparece en el
 * catálogo. La URL apunta al dominio del contenedor (`letiende.co/libros`,
 * no `babel.letiende.co`): es la URL pública real tras el proxy de ruta, la
 * única que debe llegar a los buscadores.
 */
export const handlerSitemap: APIGatewayProxyHandlerV2 = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const libros = await escanearMayorQue<Libro>(nombreTablaLibros(), 'cantidadDisponible', 0);
    const urls = libros
      .map((libro) => `  <url><loc>${BASE_URL_PUBLICA}/libro/${escaparXml(libro.bookId)}</loc></url>`)
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    };
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
 * Un ejemplar del mismo libro por ISBN, con su propia ubicación ya resuelta
 * (Tarea 4 del lote de duplicados, `docs/plan-duplicados-catalogacion.md`
 * §7) — cada uno es el `bookId` de un panel "Ubicación en la librería" en
 * la ficha pública.
 */
interface EjemplarConUbicacion {
  bookId: string;
  pvp: number;
  cantidadDisponible: number;
  ubicacion: { espacio: string; mueble: string; ubicacion: string } | null;
}

/** Respuesta de `handlerDetalle` — extiende `LibroConUbicacion` de forma ADITIVA con `ejemplares`, sin tocar el contrato que también usa `handlerBuscarPorIsbn` (mismo `LibroConUbicacion`, con un significado distinto ahí: duplicados detectados al catalogar). */
interface LibroConEjemplares extends LibroConUbicacion {
  ejemplares: EjemplarConUbicacion[];
}

/**
 * Resuelve los ejemplares del mismo libro por ISBN (Tarea 4, apilamiento en
 * el catálogo público) — `Query` al GSI disperso `isbn-index` (nunca un
 * `Scan`), mismo índice que ya usa `handlerBuscarPorIsbn`. Sin ISBN, el
 * propio libro es su único ejemplar posible (decisión **D2**: el
 * apilamiento es SOLO por ISBN, nunca por título — cero riesgo de fusionar
 * dos libros sin relación en la cara pública). Solo incluye ejemplares con
 * `cantidadDisponible > 0` (**S6**): un arreglo vacío de vuelta significa
 * "agotado en todas las ubicaciones", la señal que usa el frontend para
 * mostrar la nota de agotado sin ningún botón VENDER — incluso si el libro
 * puntual pedido por `bookId` está agotado, sigue describiéndose en los
 * campos de nivel superior de la respuesta (comportamiento ya existente,
 * sin cambios: un enlace directo debe funcionar aunque esté agotado).
 */
async function resolverEjemplares(libro: Libro): Promise<EjemplarConUbicacion[]> {
  const candidatos =
    libro.isbn !== null
      ? await consultarPorIndice<Libro>(nombreTablaLibros(), 'isbn-index', 'isbn', libro.isbn)
      : [libro];

  const disponibles = candidatos.filter((candidato) => candidato.cantidadDisponible > 0);
  return Promise.all(
    disponibles.map(async (candidato) => ({
      bookId: candidato.bookId,
      pvp: candidato.pvp,
      cantidadDisponible: candidato.cantidadDisponible,
      ubicacion: await resolverUbicacion(candidato.ubicacionId),
    })),
  );
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
 *
 * Extendido de forma ADITIVA con `ejemplares` (Tarea 4 del lote de
 * duplicados, `docs/plan-duplicados-catalogacion.md` §7): todos los demás
 * ejemplares del mismo ISBN, cada uno con su propia ubicación y PVP —
 * apila en el catálogo público libros catalogados por separado que en
 * realidad son el mismo título. Los campos heredados de `Libro` siguen
 * describiendo el `bookId` puntual pedido por la ruta, sin cambios; solo se
 * agrega el arreglo. Único consumidor hoy (`LibroDetalleComponent`), riesgo
 * de romper algo mínimo.
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

    const [ubicacion, ejemplares] = await Promise.all([
      resolverUbicacion(libro.ubicacionId),
      resolverEjemplares(libro),
    ]);

    const libroConEjemplares: LibroConEjemplares = { ...normalizarLibro(libro), ubicacion, ejemplares };

    return respuestaJson(200, libroConEjemplares);
  } catch {
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * `GET /api/libros/por-isbn/:isbn` — busca TODOS los libros ya catalogados
 * con este ISBN exacto (`TODO.md` Tarea 2.3, detección de duplicados antes
 * de catalogar) usando el GSI `isbn-index` de `babel-libros`
 * (`consultarPorIndice`). Exige rol `vendedor` o `administrador` (CLAUDE.md
 * A01), mismo criterio que `handlerCrear`/`handlerEditar` — a diferencia de
 * `handlerDetalle`, este endpoint sí requiere sesión porque solo lo consume
 * el flujo de catalogación, no el catálogo público. `isbn` no es único hoy en
 * `babel-libros` (sin validación de unicidad), así que la respuesta puede
 * traer 0, 1 o varios resultados — nunca es un error, el llamador decide qué
 * hacer con cada caso. Cada resultado trae su ubicación física ya resuelta
 * (`resolverUbicacion`, mismo patrón que `handlerDetalle`). Ruta estática con
 * segmento literal `por-isbn`, sin conflicto con `/api/libros/:bookId`
 * (mismo criterio que `librosInventario`/`exportarInventario`).
 */
export const handlerBuscarPorIsbn: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para buscar libros en Babel.' });
    }

    const isbn = event.pathParameters?.['isbn'];
    if (!isbn) {
      return respuestaJson(400, { error: 'Falta el isbn en la ruta.' });
    }

    const libros = await consultarPorIndice<Libro>(nombreTablaLibros(), 'isbn-index', 'isbn', isbn);
    const librosConUbicacion: LibroConUbicacion[] = await Promise.all(
      libros.map(async (libro) => ({
        ...normalizarLibro(libro),
        ubicacion: await resolverUbicacion(libro.ubicacionId),
      })),
    );

    return respuestaJson(200, librosConUbicacion);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
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

    // El GSI `isbn-index` de `babel-libros` tipa `isbn` estrictamente `S`:
    // para que un libro sin ISBN quede FUERA de ese índice disperso, el
    // atributo debe estar AUSENTE al persistir — no vale con `isbn: null`
    // (DynamoDB responde `ValidationException`). `omitirCamposNulos` solo
    // afecta al objeto que se guarda; la respuesta HTTP sigue devolviendo
    // `isbn: null` explícito, tal como lo espera el frontend.
    await guardar(nombreTablaLibros(), omitirCamposNulos(libro, ['isbn']));

    return respuestaJson(201, libro);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * Datos aceptados en el body de `PUT /api/libros/:bookId` — TODOS los campos
 * del libro son editables desde la pestaña "Editar" del área "Gestionar"
 * (`ajustes-2026-07-27.md` Tarea 1, antes solo permitía ubicación/cantidad/
 * PVP/descuento editorial).
 */
interface DatosEditarLibro {
  isbn: string | null;
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  ubicacionId: string;
  cantidadTotal: number;
  pvp: number;
  porcentajeDescuentoEditorial: number;
}

type ResultadoValidacionEditar =
  | { valido: true; datos: DatosEditarLibro }
  | { valido: false; error: string };

/**
 * Valida el body de `PUT /api/libros/:bookId`: mismas reglas que
 * `validarDatosNuevoLibro` para `titulo`/`autor`/`pvp`/
 * `porcentajeDescuentoEditorial`/`isbn`/`editorial`/`portadaUrl`, salvo
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
    datos['cantidadTotal'] < 0
  ) {
    return { valido: false, error: 'La cantidad total debe ser un número entero mayor o igual a 0.' };
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
 * `handlerCambiarUbicacion` (que solo cambiaba `ubicacionId`): ahora permite
 * corregir TODOS los campos del libro (`ajustes-2026-07-27.md` Tarea 1) —
 * `titulo`/`autor`/`isbn`/`editorial`/`portadaUrl`, `ubicacionId`,
 * `cantidadTotal` (incluida una baja hasta 0), `pvp` y
 * `porcentajeDescuentoEditorial`. `bookId` (uuid) sigue siendo la clave
 * primaria real en DynamoDB — editar el `isbn` es un cambio de dato seguro,
 * no toca ninguna clave.
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
      isbn: datos.isbn,
      titulo: datos.titulo,
      autor: datos.autor,
      editorial: datos.editorial,
      portadaUrl: datos.portadaUrl,
      ubicacionId: datos.ubicacionId,
      cantidadTotal: datos.cantidadTotal,
      cantidadDisponible,
      pvp: datos.pvp,
      porcentajeDescuentoEditorial: datos.porcentajeDescuentoEditorial,
      costo: Math.round(datos.pvp * (1 - datos.porcentajeDescuentoEditorial / 100)),
      utilidadCatalogo: Math.round(datos.pvp * (datos.porcentajeDescuentoEditorial / 100)),
      actualizadoEn: new Date().toISOString(),
    };

    // Mismo criterio que `handlerCrear`: se persiste sin el `isbn` cuando es
    // `null` (GSI `isbn-index` tipado `S`), pero la respuesta HTTP sigue
    // devolviendo `libroActualizado` completo, con `isbn: null` explícito.
    await guardar(nombreTablaLibros(), omitirCamposNulos(libroActualizado, ['isbn']));

    return respuestaJson(200, libroActualizado);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/**
 * Datos aceptados en el body de
 * `POST /api/libros/:bookId/fusionar-duplicado` — mismos campos editables
 * que `PUT /api/libros/:bookId` (`DatosEditarLibro`) MENOS `cantidadTotal`
 * (que aquí NUNCA es un valor absoluto) MÁS `ejemplaresNuevos`: el DELTA de
 * ejemplares que se suman al total existente (`TODO.md` Tarea 2.3,
 * corrección de condición de carrera — ver `fusionarLibroDuplicado` en
 * `dynamodb.ts`).
 */
interface DatosFusionarDuplicado {
  isbn: string | null;
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  ubicacionId: string;
  pvp: number;
  porcentajeDescuentoEditorial: number;
  ejemplaresNuevos: number;
}

type ResultadoValidacionFusionar =
  | { valido: true; datos: DatosFusionarDuplicado }
  | { valido: false; error: string };

/**
 * Valida el body de `POST /api/libros/:bookId/fusionar-duplicado`: mismas
 * reglas que `validarDatosEditarLibro` para
 * `titulo`/`autor`/`ubicacionId`/`pvp`/`porcentajeDescuentoEditorial`/
 * `isbn`/`editorial`/`portadaUrl`, más `ejemplaresNuevos` (entero positivo —
 * a diferencia de `cantidadTotal` en `PUT`, aquí nunca es 0 ni un valor
 * absoluto: fusionar un duplicado siempre SUMA ejemplares nuevos al total
 * existente). Exportada para poder probarla sin invocar el handler completo.
 */
export function validarDatosFusionarDuplicado(cuerpo: unknown): ResultadoValidacionFusionar {
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
    typeof datos['ejemplaresNuevos'] !== 'number' ||
    !Number.isInteger(datos['ejemplaresNuevos']) ||
    datos['ejemplaresNuevos'] <= 0
  ) {
    return { valido: false, error: 'Los ejemplares nuevos deben ser un número entero mayor a 0.' };
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
      ubicacionId: datos['ubicacionId'],
      pvp: datos['pvp'],
      porcentajeDescuentoEditorial: datos['porcentajeDescuentoEditorial'],
      ejemplaresNuevos: datos['ejemplaresNuevos'],
    },
  };
}

/**
 * `POST /api/libros/:bookId/fusionar-duplicado` — fusiona un duplicado
 * detectado por ISBN (`TODO.md` Tarea 2.3) sobre un libro ya catalogado,
 * SUMANDO `ejemplaresNuevos` a `cantidadTotal`/`cantidadDisponible` con una
 * única operación atómica en DynamoDB (`fusionarLibroDuplicado`, `ADD`) — a
 * diferencia de `PUT /api/libros/:bookId` (que sobrescribe `cantidadTotal`
 * con un valor absoluto calculado por leer-calcular-sobrescribir), este
 * endpoint es seguro ante dos fusiones concurrentes sobre el MISMO libro
 * (ej. dos vendedores catalogando el mismo ISBN casi al mismo tiempo, común
 * catalogando 3.000+ libros con varios catalogadores): ninguna sobrescribe
 * el incremento de la otra, sin importar el orden de llegada de las
 * peticiones. Exige rol `vendedor` o `administrador` (CLAUDE.md A01), mismo
 * criterio que `handlerCrear`/`handlerEditar`. Valida que el `ubicacionId`
 * recibido exista antes de escribir (mismo criterio que `handlerEditar`) —
 * esta única lectura puntual (`GetItem` sobre `babel-ubicaciones`) no
 * compite con la concurrencia del libro en sí, solo confirma que la
 * ubicación destino es válida. `costo`/`utilidadCatalogo` se recalculan
 * siempre a partir de `pvp`/`porcentajeDescuentoEditorial`, nunca se reciben
 * del cliente (CLAUDE.md A08).
 */
export const handlerFusionarDuplicado: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
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

    let cuerpo: unknown;
    try {
      cuerpo = event.body ? JSON.parse(event.body) : undefined;
    } catch {
      return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
    }

    const validacion = validarDatosFusionarDuplicado(cuerpo);
    if (!validacion.valido) {
      return respuestaJson(400, { error: validacion.error });
    }
    const { datos } = validacion;

    const ubicacion = await obtenerPorClave<Ubicacion>(nombreTablaUbicaciones(), { ubicacionId: datos.ubicacionId });
    if (!ubicacion) {
      return respuestaJson(400, { error: 'La ubicación indicada no existe.' });
    }

    try {
      const libroActualizado = await fusionarLibroDuplicado<Libro>(
        nombreTablaLibros(),
        bookId,
        {
          isbn: datos.isbn,
          titulo: datos.titulo,
          autor: datos.autor,
          editorial: datos.editorial,
          portadaUrl: datos.portadaUrl,
          ubicacionId: datos.ubicacionId,
          pvp: datos.pvp,
          porcentajeDescuentoEditorial: datos.porcentajeDescuentoEditorial,
          costo: Math.round(datos.pvp * (1 - datos.porcentajeDescuentoEditorial / 100)),
          utilidadCatalogo: Math.round(datos.pvp * (datos.porcentajeDescuentoEditorial / 100)),
          actualizadoEn: new Date().toISOString(),
        },
        datos.ejemplaresNuevos,
      );
      return respuestaJson(200, libroActualizado);
    } catch (error) {
      if (error instanceof ItemNoExisteError) {
        return respuestaJson(404, { error: 'El libro no existe.' });
      }
      throw error;
    }
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
    return respuestaJson(200, libros.map(normalizarLibro));
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
 * presente (`cantidadTotal` incluye ejemplares ya vendidos) — puede ser 0
 * (libro agotado, sigue apareciendo en el reporte porque viene de
 * `escanearTodo`, no del catálogo público que sí los excluye).
 *
 * `Fecha de catalogación` (`Libro.creadoEn`) y `Catalogado por`
 * (`Libro.creadoPor`, el email de quien lo catalogó) — segunda ronda de
 * `ajustes-2026-07-27.md`, al inicio y al final de las columnas
 * respectivamente.
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
        'Fecha de catalogación': libro.creadoEn,
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
        'Catalogado por': libro.creadoPor,
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

/**
 * Normaliza texto para comparar títulos entre libros (Tarea 2 del lote de
 * duplicados, `docs/plan-duplicados-catalogacion.md` §5): minúsculas, sin
 * tildes/diacríticos (`NFD` + strip), sin caracteres especiales, espacios
 * internos colapsados, sin espacios al inicio/final — el mismo criterio
 * exacto que pidió el usuario. Exportada para tests propios.
 */
export function normalizarParaComparacion(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Componentes conexos (union-find) sobre el arreglo de libros: dos libros
 * quedan en el mismo grupo si comparten ISBN **o** título normalizado — la
 * relación ENCADENA (si A~B por ISBN y B~C por título, A/B/C quedan en el
 * mismo grupo), la lectura correcta de "dos o más libros coinciden"
 * (`docs/plan-duplicados-catalogacion.md` §5). Agrupa con `Map` por
 * ISBN/título (en vez de comparar cada par, `O(n²)` inviable con 3.000+
 * libros) y une en bloque cada bucket de 2+ índices.
 */
function agruparPorIsbnOTitulo(libros: Libro[]): number[] {
  const padre = libros.map((_, indice) => indice);

  function encontrarRaiz(indice: number): number {
    while (padre[indice] !== indice) {
      padre[indice] = padre[padre[indice] as number] as number;
      indice = padre[indice] as number;
    }
    return indice;
  }

  function unir(a: number, b: number): void {
    const raizA = encontrarRaiz(a);
    const raizB = encontrarRaiz(b);
    if (raizA !== raizB) {
      padre[raizA] = raizB;
    }
  }

  const porIsbn = new Map<string, number[]>();
  const porTitulo = new Map<string, number[]>();
  libros.forEach((libro, indice) => {
    if (libro.isbn !== null) {
      const indices = porIsbn.get(libro.isbn) ?? [];
      indices.push(indice);
      porIsbn.set(libro.isbn, indices);
    }
    const tituloNormalizado = normalizarParaComparacion(libro.titulo);
    if (tituloNormalizado !== '') {
      const indices = porTitulo.get(tituloNormalizado) ?? [];
      indices.push(indice);
      porTitulo.set(tituloNormalizado, indices);
    }
  });

  for (const indices of [...porIsbn.values(), ...porTitulo.values()]) {
    for (let i = 1; i < indices.length; i++) {
      unir(indices[0] as number, indices[i] as number);
    }
  }

  return libros.map((_, indice) => encontrarRaiz(indice));
}

/**
 * `ISBN` / `Título` / `ISBN y título` según qué coincidencia originó que
 * estos libros específicos cayeran en el mismo grupo (`docs/plan-duplicados-catalogacion.md`
 * §5, S5) — se detecta buscando un ISBN o un título normalizado que se
 * repita DENTRO del propio grupo (no contra el catálogo completo), así que
 * también funciona correctamente en un grupo de 3+ libros donde solo un
 * subconjunto comparte cada criterio.
 */
function motivoDelGrupo(librosDelGrupo: Libro[]): string {
  const isbns = librosDelGrupo.map((libro) => libro.isbn).filter((isbn): isbn is string => isbn !== null);
  const hayIsbnRepetido = new Set(isbns).size < isbns.length;
  const titulos = librosDelGrupo.map((libro) => normalizarParaComparacion(libro.titulo));
  const hayTituloRepetido = new Set(titulos).size < titulos.length;
  if (hayIsbnRepetido && hayTituloRepetido) {
    return 'ISBN y título';
  }
  return hayIsbnRepetido ? 'ISBN' : 'Título';
}

/**
 * `GET /api/libros/exportar-repetidos` — genera un XLSX con los libros
 * potencialmente repetidos en el catálogo (Tarea 2 del lote de duplicados,
 * `docs/plan-duplicados-catalogacion.md` §5): dos o más libros coinciden si
 * comparten ISBN o título normalizado (`agruparPorIsbnOTitulo`). Permite al
 * librero detectar anomalías de catalogación YA EXISTENTES en producción —
 * complementa la Tarea 1 (`catalogar-libro.component.ts`), que evita
 * duplicados NUEVOS al catalogar en la misma ubicación, pero no toca los
 * que ya están. Exige rol `administrador` EXCLUSIVAMENTE, mismo criterio
 * que `exportar`/`exportar-inventario` (información de negocio). Ruta
 * estática, sin conflicto con `/api/libros/{bookId}`.
 *
 * Mismo patrón de resolución de ubicación que `handlerExportarInventario`
 * (3 `escanearTodo` en paralelo + `Map` en memoria, más barato que un
 * `GetItem` por libro a este volumen).
 */
export const handlerExportarRepetidos: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || usuario.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para exportar este reporte en Babel.' });
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

    const raizPorIndice = agruparPorIsbnOTitulo(libros);
    const indicesPorRaiz = new Map<number, number[]>();
    raizPorIndice.forEach((raiz, indice) => {
      const indices = indicesPorRaiz.get(raiz) ?? [];
      indices.push(indice);
      indicesPorRaiz.set(raiz, indices);
    });

    // Solo grupos de 2 o más libros — un grupo de 1 no es un repetido.
    // Numerados en el orden en que se encuentran (1, 2, 3…), no por el
    // índice interno del union-find.
    let numeroDeGrupo = 0;
    const filas: Record<string, unknown>[] = [];
    for (const indices of indicesPorRaiz.values()) {
      if (indices.length < 2) {
        continue;
      }
      numeroDeGrupo++;
      const librosDelGrupo = indices.map((indice) => libros[indice] as Libro);
      const motivo = motivoDelGrupo(librosDelGrupo);
      for (const libro of librosDelGrupo) {
        const ubicacion = ubicacionPorId.get(libro.ubicacionId);
        const mueble = ubicacion ? mueblePorId.get(ubicacion.muebleId) : undefined;
        const espacio = mueble ? espacioPorId.get(mueble.espacioId) : undefined;
        filas.push({
          Grupo: numeroDeGrupo,
          Motivo: motivo,
          libroId: libro.bookId,
          ISBN: libro.isbn ?? '—',
          Título: libro.titulo,
          Autor: libro.autor,
          Editorial: libro.editorial ?? '—',
          PVP: libro.pvp,
          Espacio: espacio?.nombre ?? '—',
          Mueble: mueble?.nombre ?? '—',
          Ubicación: ubicacion?.nombre ?? '—',
        });
      }
    }

    const libroExcel = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(filas);
    XLSX.utils.book_append_sheet(libroExcel, hoja, 'Repetidos');
    const contenidoBase64 = XLSX.write(libroExcel, { type: 'base64', bookType: 'xlsx' }) as string;

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="reporte-repetidos.xlsx"',
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

/** Campos mínimos que expone `GET /api/libros/indice` (Tarea 3 del lote de duplicados, `docs/plan-duplicados-catalogacion.md` §6). */
interface LibroIndice {
  bookId: string;
  isbn: string | null;
  titulo: string;
  autor: string;
  ubicacionId: string;
  pvp: number;
  portadaUrl: string | null;
  cantidadDisponible: number;
}

/**
 * `GET /api/libros/indice` — índice ligero de TODO el catálogo (Tarea 3 del
 * lote de duplicados, `docs/plan-duplicados-catalogacion.md` §6): Babel
 * como primera fuente al buscar por título/autor al catalogar, cacheado en
 * el cliente una vez por sesión, sin golpear un `Scan` completo por cada
 * tecleo del vendedor. Exige rol `vendedor`/`administrador`, mismo criterio
 * que `handlerInventario` — es de solo lectura, sin datos sensibles.
 *
 * Usa `escanearProyeccion` (`ProjectionExpression` de DynamoDB) para traer
 * SOLO los 8 campos mínimos, no el libro completo — medido contra el
 * catálogo real de `production` (1.534 libros, 2026-08-29, `aws dynamodb
 * scan` con la misma proyección): ~360 bytes/libro sin comprimir, ~100
 * bytes/libro con gzip (que API Gateway HTTP API aplica automáticamente
 * cuando el cliente lo acepta). A 3.000 libros (volumen fundacional del
 * proyecto) el índice completo pesa ~1 MB sin comprimir, ~300 KB
 * comprimido — aceptable para una sola carga por sesión al entrar a
 * Catalogar. Se decidió mantener `portadaUrl` pese a ser, con diferencia,
 * el campo más pesado (para que el vendedor siga viendo la miniatura al
 * elegir un candidato de Babel, igual que ya ve con los candidatos
 * externos) — de crecer el catálogo mucho más allá de ese volumen, es el
 * primer campo a sacrificar.
 *
 * NO filtra por `cantidadDisponible` (a diferencia de `GET /api/libros`,
 * catálogo público): el propósito es detectar duplicados al catalogar, así
 * que un libro agotado sigue siendo relevante — mismo criterio que `GET
 * /api/libros/inventario`/`GET /api/libros/por-isbn/:isbn`.
 */
export const handlerIndice: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para ver el índice de libros en Babel.' });
    }

    const libros = await escanearProyeccion<LibroIndice>(nombreTablaLibros(), [
      'bookId',
      'isbn',
      'titulo',
      'autor',
      'ubicacionId',
      'pvp',
      'portadaUrl',
      'cantidadDisponible',
    ]);
    // Mismo motivo que `normalizarLibro`: un libro sin ISBN se persiste sin
    // el atributo (`omitirCamposNulos`), así que llega `undefined`, no
    // `null` — se restituye aquí para cumplir el contrato de `LibroIndice`.
    return respuestaJson(200, libros.map((libro) => ({ ...libro, isbn: libro.isbn ?? null })));
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
