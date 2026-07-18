import { type App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/**
 * Verificación real del ID Token de Firebase en el backend (CLAUDE.md A01/A07,
 * tech-specs.md §8.1). Usa siempre el proyecto Firebase compartido con
 * Comandante (`comandante-letiende`, MEMORY.md ADR-007) — nunca otro
 * `projectId` — con una cuenta de servicio propia de Babel
 * (`FIREBASE_SERVICE_ACCOUNT_BABEL`), distinta de la de Comandante.
 *
 * Estar autenticado en el proyecto compartido NO implica autorización en
 * Babel: esta función solo confirma la identidad (email verificado por
 * Firebase); la resolución de rol contra `babel-usuarios` es responsabilidad
 * de cada handler que la use.
 */

const PROJECT_ID_COMPARTIDO = 'comandante-letiende';

export class TokenInvalidoError extends Error {}

let appFirebaseAdmin: App | undefined;

function obtenerAppFirebaseAdmin(): App {
  if (appFirebaseAdmin) {
    return appFirebaseAdmin;
  }

  const credencialJson = process.env['FIREBASE_SERVICE_ACCOUNT_BABEL'];
  if (!credencialJson) {
    throw new Error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT_BABEL.');
  }

  // Reutilizar la app ya inicializada si el runtime de Lambda recicla el
  // proceso entre invocaciones (evita "app already exists" de firebase-admin).
  appFirebaseAdmin =
    getApps()[0] ??
    initializeApp({
      credential: cert(JSON.parse(credencialJson)),
      projectId: PROJECT_ID_COMPARTIDO,
    });
  return appFirebaseAdmin;
}

/**
 * Extrae y verifica el Bearer token del header `Authorization`. Lanza
 * `TokenInvalidoError` si el header falta, el token es inválido o expiró —
 * nunca asume un token válido.
 */
export async function verificarTokenDesdeHeader(
  headerAuthorization: string | undefined,
): Promise<{ email: string; uid: string }> {
  if (!headerAuthorization?.startsWith('Bearer ')) {
    throw new TokenInvalidoError('Falta el header Authorization: Bearer <token>.');
  }

  const token = headerAuthorization.slice('Bearer '.length).trim();
  if (!token) {
    throw new TokenInvalidoError('El token está vacío.');
  }

  let decodificado;
  try {
    decodificado = await getAuth(obtenerAppFirebaseAdmin()).verifyIdToken(token);
  } catch {
    throw new TokenInvalidoError('El token es inválido o expiró.');
  }

  if (!decodificado.email) {
    throw new TokenInvalidoError('El token no tiene un email asociado.');
  }

  return { email: decodificado.email, uid: decodificado.uid };
}
