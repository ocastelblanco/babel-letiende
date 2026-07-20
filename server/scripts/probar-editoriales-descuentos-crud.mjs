// Script operativo para TODO.md Tarea 1 (CRUD /api/editoriales-descuentos,
// solo admin). Solo lo invoca `.github/workflows/operaciones-staging.yml`
// (operación `probar-editoriales-descuentos-crud`): emite un ID Token real
// de Firebase sin depender de un login interactivo de Google (mismo
// mecanismo que `probar-usuarios-crud.mjs`) y prueba el CRUD completo de
// `/api/editoriales-descuentos` en staging. Si el correo NO es
// administrador, `GET /api/editoriales-descuentos` responde 403 (o 401 si
// el token es inválido) y el script se detiene ahí — no intenta el resto
// del ciclo. Si SÍ es administrador, hace POST → GET → PUT → DELETE sobre
// una editorial de prueba fija, limpiándola al terminar (incluida una
// limpieza defensiva previa por si un run anterior la dejó huérfana). No
// forma parte del código de producción de ninguna Lambda. Ver MEMORY.md §9.
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

const EDITORIAL_OBJETIVO = 'Editorial De Prueba CRUD';
const DESCUENTO_OBJETIVO = {
  editorial: EDITORIAL_OBJETIVO,
  porcentajePorDefecto: 35,
  porcentajesDisponibles: [30, 35, 40],
};

async function main() {
  const email = requerirEnv('EMAIL');
  const urlBase = requerirEnv('URL_STAGING');
  const credencialJson = requerirEnv('FIREBASE_SERVICE_ACCOUNT_BABEL');
  const rutaObjetivo = `${urlBase}/api/editoriales-descuentos/${encodeURIComponent(EDITORIAL_OBJETIVO)}`;

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

    const respuestaGetInicial = await fetch(`${urlBase}/api/editoriales-descuentos`, { headers });
    console.log(`GET /api/editoriales-descuentos (email=${email}) -> HTTP ${respuestaGetInicial.status}`);
    console.log(await respuestaGetInicial.text());

    if (respuestaGetInicial.status !== 200) {
      console.log('No es administrador (o el token no es válido) — se detiene el ciclo CRUD aquí.');
      return;
    }

    // Limpieza defensiva por si un run anterior falló antes del DELETE
    // final y dejó la editorial objetivo huérfana — ignorar el resultado
    // (404 es el caso normal, nada que limpiar).
    await fetch(rutaObjetivo, { method: 'DELETE', headers });

    const respuestaPost = await fetch(`${urlBase}/api/editoriales-descuentos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(DESCUENTO_OBJETIVO),
    });
    const cuerpoPost = await respuestaPost.text();
    console.log(`POST /api/editoriales-descuentos -> HTTP ${respuestaPost.status}`);
    console.log(cuerpoPost);
    if (respuestaPost.status !== 201) {
      throw new Error('POST /api/editoriales-descuentos no respondió 201, se aborta el resto del ciclo.');
    }

    try {
      const respuestaPut = await fetch(rutaObjetivo, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ porcentajePorDefecto: 40, porcentajesDisponibles: [40] }),
      });
      console.log(`PUT ${rutaObjetivo} -> HTTP ${respuestaPut.status}`);
      console.log(await respuestaPut.text());

      const respuestaGetFinal = await fetch(`${urlBase}/api/editoriales-descuentos`, { headers });
      const listaFinal = await respuestaGetFinal.json();
      const objetivo = Array.isArray(listaFinal)
        ? listaFinal.find((d) => d.editorial === EDITORIAL_OBJETIVO)
        : undefined;
      console.log(
        `GET /api/editoriales-descuentos (post-PUT) -> HTTP ${respuestaGetFinal.status} — porcentajePorDefecto actualizado: ${objetivo?.porcentajePorDefecto}`,
      );
    } finally {
      const respuestaDelete = await fetch(rutaObjetivo, { method: 'DELETE', headers });
      console.log(`DELETE ${rutaObjetivo} -> HTTP ${respuestaDelete.status}`);
      if (respuestaDelete.status === 204) {
        console.log(`🧹 Editorial de prueba eliminada de babel-editoriales-descuentos: ${EDITORIAL_OBJETIVO}`);
      }
    }
  } finally {
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-editoriales-descuentos-crud:', error);
  process.exit(1);
});
