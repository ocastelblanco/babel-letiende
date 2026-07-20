// Script operativo para TODO.md Tarea 1 (GET /api/ventas, solo admin).
// Solo lo invoca `.github/workflows/operaciones-staging.yml` (operación
// `probar-listar-ventas`): emite un ID Token real de Firebase sin depender
// de un login interactivo de Google (mismo mecanismo que
// `probar-usuarios-crud.mjs`). `GET /api/ventas` primero (sin datos de
// prueba creados todavía) — si el correo no es administrador (403) o el
// token no es válido (401), el script se detiene ahí, cubriendo esos casos
// sin efectos secundarios. Si es administrador (200), cataloga 2 libros de
// prueba (editoriales distintas) y los vende (formas de pago distintas),
// luego verifica GET /api/ventas sin filtro, filtrando por formaDePago y
// filtrando por editorial. Limpia libros y ventas de prueba al terminar. No
// forma parte del código de producción de ninguna Lambda. Ver MEMORY.md §9.
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

const LIBRO_A = {
  isbn: '9780000000010',
  titulo: 'Libro de prueba A (probar-listar-ventas)',
  autor: 'Autor de prueba',
  editorial: 'Editorial De Prueba A',
  portadaUrl: null,
  pvp: 50000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 1,
  estanteId: 'estante-de-prueba',
};

const LIBRO_B = {
  isbn: '9780000000011',
  titulo: 'Libro de prueba B (probar-listar-ventas)',
  autor: 'Autor de prueba',
  editorial: 'Editorial De Prueba B',
  portadaUrl: null,
  pvp: 30000,
  porcentajeDescuentoEditorial: 35,
  cantidadTotal: 1,
  estanteId: 'estante-de-prueba',
};

async function main() {
  const email = requerirEnv('EMAIL');
  const urlBase = requerirEnv('URL_STAGING');
  const credencialJson = requerirEnv('FIREBASE_SERVICE_ACCOUNT_BABEL');
  const tablaLibros = requerirEnv('TABLA_LIBROS');
  const tablaVentas = requerirEnv('TABLA_VENTAS');
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

  const bookIdsCreados = [];
  const ventaIdsCreadas = [];
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

    const respuestaGetInicial = await fetch(`${urlBase}/api/ventas`, { headers });
    console.log(`GET /api/ventas (email=${email}) -> HTTP ${respuestaGetInicial.status}`);
    console.log(await respuestaGetInicial.text());

    if (respuestaGetInicial.status !== 200) {
      console.log('No es administrador (o el token no es válido) — se detiene el ciclo aquí.');
      return;
    }

    for (const [libro, formaDePago] of [
      [LIBRO_A, 'efectivo'],
      [LIBRO_B, 'tarjeta'],
    ]) {
      const respuestaLibro = await fetch(`${urlBase}/api/libros`, {
        method: 'POST',
        headers,
        body: JSON.stringify(libro),
      });
      const cuerpoLibro = await respuestaLibro.text();
      console.log(`POST /api/libros (${libro.editorial}) -> HTTP ${respuestaLibro.status}`);
      if (respuestaLibro.status !== 201) {
        throw new Error(`POST /api/libros no respondió 201: ${cuerpoLibro}`);
      }
      const bookId = JSON.parse(cuerpoLibro).bookId;
      bookIdsCreados.push(bookId);

      const respuestaVenta = await fetch(`${urlBase}/api/ventas`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ bookId, formaDePago, porcentajeDescuentoVenta: 0 }),
      });
      const cuerpoVenta = await respuestaVenta.text();
      console.log(`POST /api/ventas (bookId=${bookId}, formaDePago=${formaDePago}) -> HTTP ${respuestaVenta.status}`);
      if (respuestaVenta.status !== 201) {
        throw new Error(`POST /api/ventas no respondió 201: ${cuerpoVenta}`);
      }
      ventaIdsCreadas.push(JSON.parse(cuerpoVenta).ventaId);
    }

    const respuestaSinFiltro = await fetch(`${urlBase}/api/ventas`, { headers });
    const ventasSinFiltro = await respuestaSinFiltro.json();
    const contienenAmbas = ventaIdsCreadas.every((id) => ventasSinFiltro.some((v) => v.ventaId === id));
    console.log(`GET /api/ventas (sin filtro) -> HTTP ${respuestaSinFiltro.status} — ¿aparecen ambas ventas de prueba? ${contienenAmbas}`);

    const respuestaFormaDePago = await fetch(`${urlBase}/api/ventas?formaDePago=tarjeta`, { headers });
    const ventasFormaDePago = await respuestaFormaDePago.json();
    const soloTarjeta = ventasFormaDePago.every((v) => v.formaDePago === 'tarjeta');
    const apareceVentaB = ventasFormaDePago.some((v) => v.ventaId === ventaIdsCreadas[1]);
    console.log(
      `GET /api/ventas?formaDePago=tarjeta -> HTTP ${respuestaFormaDePago.status} — ¿todas son tarjeta? ${soloTarjeta} — ¿aparece la venta B? ${apareceVentaB}`,
    );

    const respuestaEditorial = await fetch(`${urlBase}/api/ventas?editorial=${encodeURIComponent(LIBRO_A.editorial)}`, {
      headers,
    });
    const ventasEditorial = await respuestaEditorial.json();
    const apareceVentaA = ventasEditorial.some((v) => v.ventaId === ventaIdsCreadas[0]);
    const noApareceVentaB = !ventasEditorial.some((v) => v.ventaId === ventaIdsCreadas[1]);
    console.log(
      `GET /api/ventas?editorial=${LIBRO_A.editorial} -> HTTP ${respuestaEditorial.status} — ¿aparece la venta A? ${apareceVentaA} — ¿NO aparece la venta B? ${noApareceVentaB}`,
    );
  } finally {
    await auth.deleteUser(usuario.uid);
    console.log(`🧹 Usuario de prueba de Firebase Auth eliminado: ${email}`);

    for (const ventaId of ventaIdsCreadas) {
      await dynamo.send(new DeleteCommand({ TableName: tablaVentas, Key: { ventaId } }));
    }
    if (ventaIdsCreadas.length > 0) {
      console.log(`🧹 Ventas de prueba eliminadas de ${tablaVentas}: ${ventaIdsCreadas.join(', ')}`);
    }
    for (const bookId of bookIdsCreados) {
      await dynamo.send(new DeleteCommand({ TableName: tablaLibros, Key: { bookId } }));
    }
    if (bookIdsCreados.length > 0) {
      console.log(`🧹 Libros de prueba eliminados de ${tablaLibros}: ${bookIdsCreados.join(', ')}`);
    }
  }
}

main().catch((error) => {
  console.error('✘ Falló probar-listar-ventas:', error);
  process.exit(1);
});
