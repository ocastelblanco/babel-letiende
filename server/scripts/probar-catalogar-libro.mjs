// Script operativo para TODO.md Tarea 1 (POST /api/libros protegido).
// Solo lo invoca `.github/workflows/operaciones-staging.yml`
// (operación `probar-catalogar-libro`): emite un ID Token real de Firebase
// sin depender de un login interactivo de Google (mismo mecanismo que
// `probar-usuarios-me.mjs`) y llama POST /api/libros en staging de punta a
// punta. Si el libro se llega a crear (201), lo elimina de
// `babel-libros-staging` al terminar para no dejar datos de prueba. No forma
// parte del código de producción de ninguna Lambda. Ver MEMORY.md §9.
import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
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

const LIBRO_DE_PRUEBA = {
  isbn: '9780000000000',
  titulo: 'Libro de prueba (operaciones-staging)',
  autor: 'Autor de prueba',
  editorial: 'Editorial de prueba',
  portadaUrl: null,
  pvp: 45000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 1,
  estanteId: 'estante-de-prueba',
};

async function main() {
  const email = requerirEnv('EMAIL');
  const urlBase = requerirEnv('URL_STAGING');
  const credencialJson = requerirEnv('FIREBASE_SERVICE_ACCOUNT_BABEL');
  const tablaLibros = requerirEnv('TABLA_LIBROS');

  const app = initializeApp({
    credential: cert(JSON.parse(credencialJson)),
    projectId: 'comandante-letiende',
  });
  const auth = getAuth(app);
  // Región explícita: a diferencia de una Lambda real (que la recibe
  // automáticamente del runtime), este script corre en un runner de GitHub
  // Actions — el SDK de JS v3 no cae de vuelta a AWS_DEFAULT_REGION (esa es
  // una convención del AWS CLI), así que se resuelve explícitamente aquí en
  // vez de depender únicamente de que el workflow declare AWS_REGION.
  const region = process.env['AWS_REGION'] ?? requerirEnv('AWS_DEFAULT_REGION');
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  let usuario;
  try {
    usuario = await auth.getUserByEmail(email);
  } catch {
    usuario = await auth.createUser({ email, emailVerified: true });
  }

  let bookIdCreado;
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

    const respuestaEndpoint = await fetch(`${urlBase}/api/libros`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${datosCanje.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(LIBRO_DE_PRUEBA),
    });
    const cuerpo = await respuestaEndpoint.text();
    console.log(`POST /api/libros (email=${email}) -> HTTP ${respuestaEndpoint.status}`);
    console.log(cuerpo);

    if (respuestaEndpoint.status === 201) {
      bookIdCreado = JSON.parse(cuerpo).bookId;
    }
  } finally {
    // Limpieza siempre, incluso si el canje o la llamada al endpoint fallan.
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);

    if (bookIdCreado) {
      await dynamo.send(new DeleteCommand({ TableName: tablaLibros, Key: { bookId: bookIdCreado } }));
      console.log(`🧹 Libro de prueba eliminado de ${tablaLibros}: ${bookIdCreado}`);
    }
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-catalogar-libro:', error);
  process.exit(1);
});
