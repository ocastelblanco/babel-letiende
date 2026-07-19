import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { escanearMayorQue } from '../services/dynamodb';

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
