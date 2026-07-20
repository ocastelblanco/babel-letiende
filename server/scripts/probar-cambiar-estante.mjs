// Script operativo para TODO.md Tarea 1 (PATCH /api/libros/:bookId/estante).
// Solo lo invoca `.github/workflows/operaciones-staging.yml` (operación
// `probar-cambiar-estante`): emite un ID Token real de Firebase sin
// depender de un login interactivo de Google (mismo mecanismo que
// `probar-catalogar-libro.mjs`). Siembra dos estantes desechables por
// DynamoDB directo (origen/destino, para no depender de que estante-1/
// estante-2 ya existan), cataloga un libro de prueba real apuntando al
// estante origen (POST /api/libros), cambia su estante al destino (PATCH),
// y confirma el cambio con GET /api/libros. Limpia todo (libro, ambos
// estantes, usuario de Firebase Auth) al terminar, incluso si algo falla a
// mitad de camino. No forma parte del código de producción de ninguna
// Lambda. Ver MEMORY.md §9.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
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

const estanteOrigen = { estanteId: `estante-prueba-origen-${randomUUID()}`, espacio: 'Prueba', mueble: 'Prueba', ubicacion: 'Origen' };
const estanteDestino = { estanteId: `estante-prueba-destino-${randomUUID()}`, espacio: 'Prueba', mueble: 'Prueba', ubicacion: 'Destino' };

function libroDePrueba(estanteId) {
  return {
    isbn: '9780000000001',
    titulo: 'Libro de prueba (probar-cambiar-estante)',
    autor: 'Autor de prueba',
    editorial: 'Editorial de prueba',
    portadaUrl: null,
    pvp: 45000,
    porcentajeDescuentoEditorial: 35,
    cantidadTotal: 1,
    estanteId,
  };
}

async function main() {
  const email = requerirEnv('EMAIL');
  const urlBase = requerirEnv('URL_STAGING');
  const credencialJson = requerirEnv('FIREBASE_SERVICE_ACCOUNT_BABEL');
  const tablaLibros = requerirEnv('TABLA_LIBROS');
  const tablaEstantes = requerirEnv('TABLA_ESTANTES');
  const region = process.env['AWS_REGION'] ?? requerirEnv('AWS_DEFAULT_REGION');
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

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

  let bookIdCreado;
  try {
    await dynamo.send(new PutCommand({ TableName: tablaEstantes, Item: estanteOrigen }));
    await dynamo.send(new PutCommand({ TableName: tablaEstantes, Item: estanteDestino }));
    console.log(`✅ Estantes de prueba sembrados: ${estanteOrigen.estanteId} (origen), ${estanteDestino.estanteId} (destino)`);

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

    const respuestaPost = await fetch(`${urlBase}/api/libros`, {
      method: 'POST',
      headers,
      body: JSON.stringify(libroDePrueba(estanteOrigen.estanteId)),
    });
    const cuerpoPost = await respuestaPost.text();
    console.log(`POST /api/libros (email=${email}) -> HTTP ${respuestaPost.status}`);
    console.log(cuerpoPost);

    if (respuestaPost.status !== 201) {
      console.log('No se pudo catalogar el libro de prueba (correo no autorizado o token inválido) — se detiene aquí.');
      return;
    }
    bookIdCreado = JSON.parse(cuerpoPost).bookId;

    const respuestaPatch = await fetch(`${urlBase}/api/libros/${bookIdCreado}/estante`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ estanteId: estanteDestino.estanteId }),
    });
    console.log(`PATCH /api/libros/${bookIdCreado}/estante -> HTTP ${respuestaPatch.status}`);
    console.log(await respuestaPatch.text());

    const respuestaGet = await fetch(`${urlBase}/api/libros`, { headers });
    const catalogo = await respuestaGet.json();
    const libroActualizado = Array.isArray(catalogo) ? catalogo.find((l) => l.bookId === bookIdCreado) : undefined;
    console.log(
      `GET /api/libros (post-PATCH) -> HTTP ${respuestaGet.status} — estanteId actual del libro: ${libroActualizado?.estanteId}`,
    );
  } finally {
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);

    if (bookIdCreado) {
      await dynamo.send(new DeleteCommand({ TableName: tablaLibros, Key: { bookId: bookIdCreado } }));
      console.log(`🧹 Libro de prueba eliminado de ${tablaLibros}: ${bookIdCreado}`);
    }
    await dynamo.send(new DeleteCommand({ TableName: tablaEstantes, Key: { estanteId: estanteOrigen.estanteId } }));
    await dynamo.send(new DeleteCommand({ TableName: tablaEstantes, Key: { estanteId: estanteDestino.estanteId } }));
    console.log(`🧹 Estantes de prueba eliminados de ${tablaEstantes}`);
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-cambiar-estante:', error);
  process.exit(1);
});
