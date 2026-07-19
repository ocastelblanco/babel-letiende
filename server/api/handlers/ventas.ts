import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { decrementarSiPositivo, guardar, obtenerPorClave } from '../services/dynamodb';

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
