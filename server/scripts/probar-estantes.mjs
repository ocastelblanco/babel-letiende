// Script operativo para TODO.md Tarea 1 (CRUD /api/estantes, solo admin).
// Solo lo invoca `.github/workflows/operaciones-staging.yml` (operación
// `probar-estantes`): emite un ID Token real de Firebase sin depender de un
// login interactivo de Google (mismo mecanismo que `probar-usuarios-me.mjs`)
// y prueba el CRUD completo de `/api/estantes` en staging. Si el correo NO
// es administrador, `GET /api/estantes` responde 403 (o 401 si el token es
// inválido) y el script se detiene ahí — no intenta el resto del ciclo. Si
// SÍ es administrador, hace POST → GET → PUT → DELETE y limpia el estante de
// prueba que creó. No forma parte del código de producción de ninguna
// Lambda. Ver MEMORY.md §9.
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

const ESTANTE_DE_PRUEBA = {
  espacio: 'Espacio de prueba (operaciones-staging)',
  mueble: 'Mueble de prueba',
  ubicacion: 'Ubicación de prueba',
};

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
    const headers = {
      Authorization: `Bearer ${datosCanje.idToken}`,
      'Content-Type': 'application/json',
    };

    const respuestaGetInicial = await fetch(`${urlBase}/api/estantes`, { headers });
    console.log(`GET /api/estantes (email=${email}) -> HTTP ${respuestaGetInicial.status}`);
    console.log(await respuestaGetInicial.text());

    if (respuestaGetInicial.status !== 200) {
      console.log('No es administrador (o el token no es válido) — se detiene el ciclo CRUD aquí.');
      return;
    }

    const respuestaPost = await fetch(`${urlBase}/api/estantes`, {
      method: 'POST',
      headers,
      body: JSON.stringify(ESTANTE_DE_PRUEBA),
    });
    const cuerpoPost = await respuestaPost.text();
    console.log(`POST /api/estantes -> HTTP ${respuestaPost.status}`);
    console.log(cuerpoPost);
    if (respuestaPost.status !== 201) {
      throw new Error('POST /api/estantes no respondió 201, se aborta el resto del ciclo.');
    }
    const estanteId = JSON.parse(cuerpoPost).estanteId;

    try {
      const respuestaPut = await fetch(`${urlBase}/api/estantes/${estanteId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...ESTANTE_DE_PRUEBA, ubicacion: 'Ubicación de prueba (actualizada)' }),
      });
      console.log(`PUT /api/estantes/${estanteId} -> HTTP ${respuestaPut.status}`);
      console.log(await respuestaPut.text());

      const respuestaGetFinal = await fetch(`${urlBase}/api/estantes`, { headers });
      const listaFinal = await respuestaGetFinal.json();
      const aparece = Array.isArray(listaFinal) && listaFinal.some((e) => e.estanteId === estanteId);
      console.log(`GET /api/estantes (post-PUT) -> HTTP ${respuestaGetFinal.status} — ¿aparece el estante de prueba? ${aparece}`);
    } finally {
      const respuestaDelete = await fetch(`${urlBase}/api/estantes/${estanteId}`, {
        method: 'DELETE',
        headers,
      });
      console.log(`DELETE /api/estantes/${estanteId} -> HTTP ${respuestaDelete.status}`);
      if (respuestaDelete.status === 204) {
        console.log(`🧹 Estante de prueba eliminado: ${estanteId}`);
      }
    }
  } finally {
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-estantes:', error);
  process.exit(1);
});
