import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { decrementarSiPositivo, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

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

type FormaDePago = 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'daviplata';
const FORMAS_DE_PAGO: readonly FormaDePago[] = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata'];

/** Copia local de `src/app/core/models/venta.model.ts` — mismo motivo que arriba. */
interface Venta {
  ventaId: string;
  bookId: string;
  isbn: string | null;
  pvp: number;
  porcentajeDescuentoVenta: number;
  precioFinal: number;
  costoLibro: number;
  utilidad: number;
  formaDePago: FormaDePago;
  vendidoPor: string;
  vendidoEn: string;
}

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que arriba. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}

function respuestaJson(statusCode: number, cuerpo: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

function nombreTablaVentas(): string {
  const nombre = process.env['TABLA_VENTAS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_VENTAS.');
  }
  return nombre;
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

/**
 * Verifica el ID Token y exige rol `administrador` exclusivamente (CLAUDE.md
 * A01) — a diferencia de `POST /api/ventas`, un reporte con costos/
 * utilidades es información sensible de negocio, `vendedor` no basta.
 */
async function exigirAdministrador(headerAuthorization: string | undefined): Promise<string | null> {
  const { email } = await verificarTokenDesdeHeader(headerAuthorization);
  const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
  return usuario?.rol === 'administrador' ? email : null;
}

/** Datos aceptados en el body de `POST /api/ventas` — el resto lo genera/resuelve el backend (ver `handler`). */
interface DatosNuevaVenta {
  bookId: string;
  formaDePago: FormaDePago;
  porcentajeDescuentoVenta: number;
}

type ResultadoValidacion = { valido: true; datos: DatosNuevaVenta } | { valido: false; error: string };

/**
 * Valida el body de `POST /api/ventas`. Exportada para poder probarla sin
 * invocar el handler completo (mismo patrón que `validarDatosNuevoLibro` en
 * `libros.ts`).
 */
export function validarDatosNuevaVenta(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['bookId'] !== 'string' || datos['bookId'].trim() === '') {
    return { valido: false, error: 'El bookId es requerido.' };
  }
  if (
    typeof datos['formaDePago'] !== 'string' ||
    !FORMAS_DE_PAGO.includes(datos['formaDePago'] as FormaDePago)
  ) {
    return { valido: false, error: `La forma de pago debe ser una de: ${FORMAS_DE_PAGO.join(', ')}.` };
  }
  if (
    typeof datos['porcentajeDescuentoVenta'] !== 'number' ||
    !Number.isFinite(datos['porcentajeDescuentoVenta']) ||
    datos['porcentajeDescuentoVenta'] < 0 ||
    datos['porcentajeDescuentoVenta'] > 100
  ) {
    return { valido: false, error: 'El porcentaje de descuento de venta debe estar entre 0 y 100.' };
  }

  return {
    valido: true,
    datos: {
      bookId: datos['bookId'],
      formaDePago: datos['formaDePago'] as FormaDePago,
      porcentajeDescuentoVenta: datos['porcentajeDescuentoVenta'],
    },
  };
}

/**
 * `POST /api/ventas` — registra una venta (tech-specs.md §5, "Vendedor/Admin").
 * Exige rol `vendedor` o `administrador` en `babel-usuarios` (CLAUDE.md A01)
 * — nunca confía en `pvp`/`costoLibro` enviados desde el cliente (CLAUDE.md
 * A08): ambos se leen del `Libro` real al momento de la venta. Decrementa
 * `cantidadDisponible` de forma condicional (ADR-003/MEMORY.md §7) para
 * evitar sobrevender.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario || (usuario.rol !== 'vendedor' && usuario.rol !== 'administrador')) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para registrar ventas en Babel.' });
    }

    let cuerpo: unknown;
    try {
      cuerpo = event.body ? JSON.parse(event.body) : undefined;
    } catch {
      return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
    }

    const validacion = validarDatosNuevaVenta(cuerpo);
    if (!validacion.valido) {
      return respuestaJson(400, { error: validacion.error });
    }
    const { datos } = validacion;

    const libro = await obtenerPorClave<Libro>(nombreTablaLibros(), { bookId: datos.bookId });
    if (!libro) {
      return respuestaJson(404, { error: 'El libro no existe.' });
    }

    const decrementado = await decrementarSiPositivo(
      nombreTablaLibros(),
      { bookId: datos.bookId },
      'cantidadDisponible',
    );
    if (!decrementado) {
      return respuestaJson(400, { error: 'No quedan ejemplares disponibles de este libro.' });
    }

    const precioFinal = Math.round(libro.pvp * (1 - datos.porcentajeDescuentoVenta / 100));
    const venta: Venta = {
      ventaId: randomUUID(),
      bookId: libro.bookId,
      isbn: libro.isbn,
      pvp: libro.pvp,
      porcentajeDescuentoVenta: datos.porcentajeDescuentoVenta,
      precioFinal,
      costoLibro: libro.costo,
      utilidad: precioFinal - libro.costo,
      formaDePago: datos.formaDePago,
      vendidoPor: email,
      vendidoEn: new Date().toISOString(),
    };

    await guardar(nombreTablaVentas(), venta);

    return respuestaJson(201, venta);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};

/** Filtros opcionales aceptados por `GET /api/ventas` — todos son query params, todos opcionales. */
interface FiltrosVentas {
  desde?: string;
  hasta?: string;
  editorial?: string;
  formaDePago?: FormaDePago;
}

type ResultadoValidacionFiltros = { valido: true; filtros: FiltrosVentas } | { valido: false; error: string };

/**
 * Valida los query params de `GET /api/ventas`. Exportada para poder
 * probarla sin invocar el handler completo (mismo patrón que
 * `validarDatosNuevaVenta`). `desde`/`hasta` deben ser fechas ISO válidas
 * (comparables directamente contra `Venta.vendidoEn`, que siempre se genera
 * con `new Date().toISOString()`); `formaDePago` debe ser uno de los 5
 * valores válidos. `editorial` no tiene formato propio que validar — se
 * compara contra `Libro.editorial` al filtrar (ver `handlerListar`).
 */
export function validarFiltrosVentas(
  query: Record<string, string | undefined> | null | undefined,
): ResultadoValidacionFiltros {
  const params = query ?? {};
  const filtros: FiltrosVentas = {};

  if (params['desde'] !== undefined) {
    if (Number.isNaN(Date.parse(params['desde']))) {
      return { valido: false, error: 'El parámetro desde debe ser una fecha ISO válida.' };
    }
    filtros.desde = params['desde'];
  }
  if (params['hasta'] !== undefined) {
    if (Number.isNaN(Date.parse(params['hasta']))) {
      return { valido: false, error: 'El parámetro hasta debe ser una fecha ISO válida.' };
    }
    filtros.hasta = params['hasta'];
  }
  if (filtros.desde && filtros.hasta && new Date(filtros.desde) > new Date(filtros.hasta)) {
    return { valido: false, error: 'El parámetro desde no puede ser posterior a hasta.' };
  }
  if (params['formaDePago'] !== undefined) {
    if (!FORMAS_DE_PAGO.includes(params['formaDePago'] as FormaDePago)) {
      return { valido: false, error: `La forma de pago debe ser una de: ${FORMAS_DE_PAGO.join(', ')}.` };
    }
    filtros.formaDePago = params['formaDePago'] as FormaDePago;
  }
  if (params['editorial'] !== undefined && params['editorial'].trim() !== '') {
    filtros.editorial = params['editorial'];
  }

  return { valido: true, filtros };
}

/**
 * `GET /api/ventas` — lista/filtra ventas para reportes (tech-specs.md §5,
 * "Admin"). Exige rol `administrador` exclusivamente. `desde`/`hasta`/
 * `formaDePago` filtran directamente sobre los campos de `Venta`; `editorial`
 * filtra contra `Libro.editorial`, resuelto por `bookId` únicamente para las
 * ventas que ya pasaron los demás filtros (evita un `Scan` completo de
 * `babel-libros`, solo `GetItem` puntuales — CLAUDE.md A05).
 *
 * **Nota de infraestructura:** el GSI `vendidoEn-index` de `babel-ventas`
 * (`serverless.yml`) solo tiene `vendidoEn` como partición (sin clave de
 * ordenamiento), así que no admite consultas de rango vía `Query` a pesar de
 * que `tech-specs.md` lo describe como pensado para eso — se usa `Scan` +
 * filtrado en memoria (`escanearTodo`), mismo criterio ya aceptado para
 * tablas pequeñas que `estantes.ts`/`editoriales-descuentos.ts` (ver
 * `MEMORY.md` §6/§7). Corregir el GSI queda fuera de alcance de esta tarea.
 */
export const handlerListar: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, { error: 'Este correo no está autorizado para ver reportes de ventas en Babel.' });
    }

    const validacion = validarFiltrosVentas(event.queryStringParameters);
    if (!validacion.valido) {
      return respuestaJson(400, { error: validacion.error });
    }
    const { desde, hasta, editorial, formaDePago } = validacion.filtros;

    let ventas = await escanearTodo<Venta>(nombreTablaVentas());

    if (desde) {
      ventas = ventas.filter((venta) => venta.vendidoEn >= desde);
    }
    if (hasta) {
      ventas = ventas.filter((venta) => venta.vendidoEn <= hasta);
    }
    if (formaDePago) {
      ventas = ventas.filter((venta) => venta.formaDePago === formaDePago);
    }
    if (editorial) {
      const bookIds = [...new Set(ventas.map((venta) => venta.bookId))];
      const libros = await Promise.all(
        bookIds.map((bookId) => obtenerPorClave<Libro>(nombreTablaLibros(), { bookId })),
      );
      const editorialPorBookId = new Map(bookIds.map((bookId, indice) => [bookId, libros[indice]?.editorial ?? null]));
      ventas = ventas.filter((venta) => editorialPorBookId.get(venta.bookId) === editorial);
    }

    return respuestaJson(200, ventas);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
