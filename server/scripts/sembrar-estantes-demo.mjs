// Script operativo (no forma parte del código de producción de ninguna
// Lambda): siembra un par de estantes reales y presentables (no
// desechables) en `babel-estantes-staging`, para que el <select> de
// CatalogarLibroComponent tenga opciones reales al probar la catalogación
// manual desde el navegador. Mismo patrón que `sembrar-libros-demo.mjs`:
// usa `estanteId` fijos (`estante-1`/`estante-2`) — volver a correr el
// script actualiza los mismos 2 ítems en vez de crear duplicados. Estos
// IDs no son arbitrarios: son los mismos que ya referencian los 3 libros
// de `sembrar-libros-demo.mjs` (`estanteId: 'estante-1'`/`'estante-2'`),
// que hasta ahora apuntaban a estantes inexistentes. Solo lo invoca
// `.github/workflows/operaciones-staging.yml` (operación
// `sembrar-estantes-demo`).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

function requerirEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta la variable de entorno ${nombre}.`);
    process.exit(1);
  }
  return valor;
}

const ESTANTES_DEMO = [
  { estanteId: 'estante-1', espacio: 'Sala principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 1' },
  { estanteId: 'estante-2', espacio: 'Sala principal', mueble: 'Biblioteca 1', ubicacion: 'Estante 2' },
];

async function main() {
  const tablaEstantes = requerirEnv('TABLA_ESTANTES');
  const region = process.env['AWS_REGION'] ?? requerirEnv('AWS_DEFAULT_REGION');
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  for (const estante of ESTANTES_DEMO) {
    await dynamo.send(new PutCommand({ TableName: tablaEstantes, Item: estante }));
    console.log(`✅ Sembrado en ${tablaEstantes}: ${estante.estanteId} — ${estante.espacio} / ${estante.mueble} / ${estante.ubicacion}`);
  }
}

main().catch((error) => {
  console.error('✘ Falló sembrar-estantes-demo:', error);
  process.exit(1);
});
