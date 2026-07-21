import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { obtenerMetadatosPorIsbn } from '../services/api-letiende';
import { obtenerPorClave } from '../services/dynamodb';

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que `estantes.ts`/`usuarios-me.ts`. */
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

function nombreTablaUsuarios(): string {
  const nombre = process.env['TABLA_USUARIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_USUARIOS.');
  }
  return nombre;
}

/**
 * `GET /api/metadatos/:isbn` — autocompleta título/autor/editorial/portada
 * al catalogar un libro, a partir de la API externa `api.letiende.co`
 * (`server/api/services/api-letiende.ts`). Exige rol `vendedor` **o**
 * `administrador`, mismo criterio que `GET /api/estantes`: es de solo
 * lectura, sin datos sensibles, y un vendedor lo necesita en el flujo
 * normal de catalogación.
 *
 * Siempre responde `200` — con los campos en `null` si no se encontró nada
 * o la API externa falló/está inestable. "No encontrado" es un resultado
 * válido del flujo (PRD.md §5.2, "el vendedor los completa manualmente"),
 * nunca un error que deba bloquear ni alarmar (CLAUDE.md A08).
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (usuario?.rol !== 'vendedor' && usuario?.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para consultar metadatos en Babel.' });
    }

    const isbn = event.pathParameters?.['isbn'];
    if (!isbn) {
      return respuestaJson(400, { error: 'Falta el isbn en la ruta.' });
    }

    const metadatos = await obtenerMetadatosPorIsbn(isbn);
    return respuestaJson(200, metadatos);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
