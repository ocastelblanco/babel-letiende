// Script operativo para TODO.md Tarea 1 (verificación real del ID Token).
// Solo lo invoca `.github/workflows/operaciones-staging.yml`
// (operación `probar-usuarios-me`): emite un ID Token real de Firebase sin
// depender de un login interactivo de Google (custom token de
// firebase-admin, canjeado por la REST API de Identity Toolkit) y llama
// GET /api/usuarios/me en staging de punta a punta. No forma parte del
// código de producción de ninguna Lambda. Ver MEMORY.md §9.
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function requerirEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}.`);
    process.exit(1);
  }
  return valor;
}

function leerApiKeyPublica() {
  const rutaEnvironment = new URL('../../src/environments/environment.ts', import.meta.url);
  const contenido = readFileSync(rutaEnvironment, 'utf8');
  const coincidencia = contenido.match(/apiKey:\s*'([^']+)'/);
  if (!coincidencia) {
    throw new Error('No se pudo extraer apiKey de src/environments/environment.ts');
  }
  return coincidencia[1];
}

async function main() {
  const email = requerirEnv('EMAIL');
  const urlBase = requerirEnv('URL_STAGING');
  const credencialJson = requerirEnv('FIREBASE_SERVICE_ACCOUNT_BABEL');

  const app = initializeApp({
    credential: cert(JSON.parse(credencialJson)),
    projectId: 'comandante-letiende',
  });
  const auth = getAuth(app);

  let usuario;
  try {
    usuario = await auth.getUserByEmail(email);
  } catch {
    usuario = await auth.createUser({ email, emailVerified: true });
  }

  try {
    const customToken = await auth.createCustomToken(usuario.uid);
    const apiKey = leerApiKeyPublica();

    const respuestaCanje = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      },
    );
    const datosCanje = await respuestaCanje.json();
    if (!respuestaCanje.ok) {
      throw new Error(`No se pudo canjear el custom token: ${JSON.stringify(datosCanje)}`);
    }

    const respuestaEndpoint = await fetch(`${urlBase}/api/usuarios/me`, {
      headers: { Authorization: `Bearer ${datosCanje.idToken}` },
    });
    const cuerpo = await respuestaEndpoint.text();
    console.log(`GET /api/usuarios/me (email=${email}) -> HTTP ${respuestaEndpoint.status}`);
    console.log(cuerpo);
  } finally {
    // Limpieza siempre, incluso si el canje o la llamada al endpoint fallan.
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-usuarios-me:', error);
  process.exit(1);
});
