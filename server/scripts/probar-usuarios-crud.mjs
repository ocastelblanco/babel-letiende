// Script operativo para TODO.md Tarea 1 (CRUD /api/usuarios, solo admin).
// Solo lo invoca `.github/workflows/operaciones-staging.yml` (operación
// `probar-usuarios-crud`): emite un ID Token real de Firebase sin depender
// de un login interactivo de Google (mismo mecanismo que
// `probar-estantes.mjs`) y prueba el CRUD completo de `/api/usuarios` en
// staging. Si el correo NO es administrador, `GET /api/usuarios` responde
// 403 (o 401 si el token es inválido) y el script se detiene ahí — no
// intenta el resto del ciclo. Si SÍ es administrador, hace
// POST → GET → PUT → DELETE sobre un usuario objetivo de prueba (distinto
// del propio administrador, ya que el backend bloquea auto-degradación/
// auto-eliminación — ADR-009) y además confirma esa misma salvaguarda
// intentando degradarse/eliminarse a sí mismo (debe fallar con 400 en
// ambos casos). No forma parte del código de producción de ninguna Lambda.
// Ver MEMORY.md §9.
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

const EMAIL_OBJETIVO = 'objetivo-prueba-usuarios-crud@letiende.co';
const USUARIO_OBJETIVO = { email: EMAIL_OBJETIVO, nombre: 'Objetivo de prueba', rol: 'vendedor' };

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

    const respuestaGetInicial = await fetch(`${urlBase}/api/usuarios`, { headers });
    console.log(`GET /api/usuarios (email=${email}) -> HTTP ${respuestaGetInicial.status}`);
    console.log(await respuestaGetInicial.text());

    if (respuestaGetInicial.status !== 200) {
      console.log('No es administrador (o el token no es válido) — se detiene el ciclo CRUD aquí.');
      return;
    }

    const respuestaAutoDegradar = await fetch(`${urlBase}/api/usuarios/${email}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ nombre: 'Intento de auto-degradación', rol: 'vendedor' }),
    });
    console.log(`PUT /api/usuarios/${email} (auto-degradación, debe fallar) -> HTTP ${respuestaAutoDegradar.status}`);
    console.log(await respuestaAutoDegradar.text());

    const respuestaAutoEliminar = await fetch(`${urlBase}/api/usuarios/${email}`, {
      method: 'DELETE',
      headers,
    });
    console.log(`DELETE /api/usuarios/${email} (auto-eliminación, debe fallar) -> HTTP ${respuestaAutoEliminar.status}`);
    console.log(await respuestaAutoEliminar.text());

    // Limpieza defensiva por si un run anterior falló antes de llegar al
    // DELETE final y dejó el usuario objetivo huérfano — ignorar el
    // resultado (404 es el caso normal, nada que limpiar).
    await fetch(`${urlBase}/api/usuarios/${EMAIL_OBJETIVO}`, { method: 'DELETE', headers });

    const respuestaPost = await fetch(`${urlBase}/api/usuarios`, {
      method: 'POST',
      headers,
      body: JSON.stringify(USUARIO_OBJETIVO),
    });
    const cuerpoPost = await respuestaPost.text();
    console.log(`POST /api/usuarios -> HTTP ${respuestaPost.status}`);
    console.log(cuerpoPost);
    if (respuestaPost.status !== 201) {
      throw new Error('POST /api/usuarios no respondió 201, se aborta el resto del ciclo.');
    }

    try {
      const respuestaPut = await fetch(`${urlBase}/api/usuarios/${EMAIL_OBJETIVO}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ nombre: 'Objetivo de prueba (actualizado)', rol: 'administrador' }),
      });
      console.log(`PUT /api/usuarios/${EMAIL_OBJETIVO} -> HTTP ${respuestaPut.status}`);
      console.log(await respuestaPut.text());

      const respuestaGetFinal = await fetch(`${urlBase}/api/usuarios`, { headers });
      const listaFinal = await respuestaGetFinal.json();
      const aparece = Array.isArray(listaFinal) && listaFinal.some((u) => u.email === EMAIL_OBJETIVO);
      console.log(`GET /api/usuarios (post-PUT) -> HTTP ${respuestaGetFinal.status} — ¿aparece el usuario objetivo? ${aparece}`);
    } finally {
      const respuestaDelete = await fetch(`${urlBase}/api/usuarios/${EMAIL_OBJETIVO}`, {
        method: 'DELETE',
        headers,
      });
      console.log(`DELETE /api/usuarios/${EMAIL_OBJETIVO} -> HTTP ${respuestaDelete.status}`);
      if (respuestaDelete.status === 204) {
        console.log(`🧹 Usuario objetivo de prueba eliminado de babel-usuarios: ${EMAIL_OBJETIVO}`);
      }
    }
  } finally {
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-usuarios-crud:', error);
  process.exit(1);
});
