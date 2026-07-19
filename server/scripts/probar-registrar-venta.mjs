// Script operativo para TODO.md Tarea 1 (POST /api/ventas protegido).
// Solo lo invoca `.github/workflows/operaciones-staging.yml` (operación
// `probar-registrar-venta`): emite un ID Token real de Firebase sin
// depender de un login interactivo de Google (mismo mecanismo que
// `probar-usuarios-me.mjs`), cataloga un libro de prueba real con
// POST /api/libros y luego lo vende con POST /api/ventas en staging de
// punta a punta. Si el correo NO es vendedor/administrador, el primer POST
// (catalogar) ya responde 403 y el script se detiene ahí — no llega a
// intentar la venta. Si ambos POST responden 201, limpia el libro y la
// venta de prueba al terminar. No forma parte del código de producción de
// ninguna Lambda. Ver MEMORY.md §9.
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
  isbn: '9780000000001',
  titulo: 'Libro de prueba (probar-registrar-venta)',
  autor: 'Autor de prueba',
  editorial: 'Editorial de prueba',
  portadaUrl: null,
  pvp: 50000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 1,
  estanteId: 'estante-de-prueba',
};

const VENTA_DE_PRUEBA = { formaDePago: 'efectivo', porcentajeDescuentoVenta: 10 };

async function main() {
  const email = requerirEnv('EMAIL');
  const urlBase = requerirEnv('URL_STAGING');
  const credencialJson = requerirEnv('FIREBASE_SERVICE_ACCOUNT_BABEL');
  const tablaLibros = requerirEnv('TABLA_LIBROS');
  const tablaVentas = requerirEnv('TABLA_VENTAS');

  const app = initializeApp({
    credential: cert(JSON.parse(credencialJson)),
    projectId: 'comandante-letiende',
  });
  const auth = getAuth(app);
  const region = process.env['AWS_REGION'] ?? requerirEnv('AWS_DEFAULT_REGION');
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  let usuario;
  try {
    usuario = await auth.getUserByEmail(email);
  } catch {
    usuario = await auth.createUser({ email, emailVerified: true });
  }

  let bookIdCreado;
  let ventaIdCreada;
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

    const respuestaLibro = await fetch(`${urlBase}/api/libros`, {
      method: 'POST',
      headers,
      body: JSON.stringify(LIBRO_DE_PRUEBA),
    });
    const cuerpoLibro = await respuestaLibro.text();
    console.log(`POST /api/libros (email=${email}) -> HTTP ${respuestaLibro.status}`);
    console.log(cuerpoLibro);

    if (respuestaLibro.status !== 201) {
      console.log('No se pudo catalogar el libro de prueba (¿correo no autorizado?) — se detiene aquí.');
      return;
    }
    bookIdCreado = JSON.parse(cuerpoLibro).bookId;

    const respuestaVenta = await fetch(`${urlBase}/api/ventas`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bookId: bookIdCreado, ...VENTA_DE_PRUEBA }),
    });
    const cuerpoVenta = await respuestaVenta.text();
    console.log(`POST /api/ventas (bookId=${bookIdCreado}) -> HTTP ${respuestaVenta.status}`);
    console.log(cuerpoVenta);

    if (respuestaVenta.status === 201) {
      ventaIdCreada = JSON.parse(cuerpoVenta).ventaId;

      const respuestaLibroActualizado = await fetch(`${urlBase}/api/libros`);
      const libros = await respuestaLibroActualizado.json();
      const libroActualizado = libros.find((l) => l.bookId === bookIdCreado);
      console.log(
        `Verificación de cantidadDisponible tras la venta: ${
          libroActualizado ? libroActualizado.cantidadDisponible : '(ya no aparece, cantidadDisponible llegó a 0)'
        } (esperado: 0, ya que cantidadTotal era 1)`,
      );
    }
  } finally {
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);

    if (ventaIdCreada) {
      await dynamo.send(new DeleteCommand({ TableName: tablaVentas, Key: { ventaId: ventaIdCreada } }));
      console.log(`🧹 Venta de prueba eliminada de ${tablaVentas}: ${ventaIdCreada}`);
    }
    if (bookIdCreado) {
      await dynamo.send(new DeleteCommand({ TableName: tablaLibros, Key: { bookId: bookIdCreado } }));
      console.log(`🧹 Libro de prueba eliminado de ${tablaLibros}: ${bookIdCreado}`);
    }
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-registrar-venta:', error);
  process.exit(1);
});
