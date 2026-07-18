import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { obtenerPorClave } from '../services/dynamodb';

/**
 * Copia local de `src/app/core/models/usuario.model.ts` (misma forma exacta).
 * No se importa directamente porque `server/tsconfig.json` tiene `rootDir`
 * fijo en `server/` para no alterar las rutas ya desplegadas de
 * `dist-server/api/handlers/*.js` (`serverless.yml`) — cualquier archivo
 * importado fuera de `server/` rompe la compilación con TS6059. Si la
 * duplicación se vuelve dolorosa, considerar mover los modelos verdaderamente
 * compartidos a un directorio neutral (ej. `shared/models/`) incluido por
 * ambos `tsconfig` — ver MEMORY.md §7.
 */
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
 * `GET /api/usuarios/me` — resuelve el `Usuario` (y su `rol`) del token
 * verificado (CLAUDE.md A01/A07): estar autenticado en el proyecto Firebase
 * compartido con Comandante no implica autorización en Babel, por lo que
 * responde `403` si el correo no existe explícitamente en `babel-usuarios`.
 * Las respuestas de error nunca incluyen detalles internos (CLAUDE.md A05).
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (!usuario) {
      return respuestaJson(403, { error: 'Este correo no está autorizado en Babel.' });
    }

    return respuestaJson(200, usuario);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
