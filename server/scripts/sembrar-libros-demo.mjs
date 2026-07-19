// Script operativo (no forma parte del código de producción de ninguna
// Lambda): siembra un pequeño set de libros de demostración reales en
// `babel-libros-staging`, para poder probar el catálogo público
// (CatalogoPublicoComponent) desde el navegador con datos que se vean bien.
// A diferencia de `probar-catalogar-libro.mjs`, este script NO limpia los
// libros al terminar — están pensados para quedarse. Usa `bookId` fijos
// (no aleatorios) para que volver a correr el script actualice los mismos
// 3 ítems en vez de crear duplicados. Solo lo invoca
// `.github/workflows/operaciones-staging.yml` (operación `sembrar-libros-demo`).
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

function calcularLibro(base) {
  const costo = Math.round(base.pvp * (1 - base.porcentajeDescuentoEditorial / 100));
  const utilidadCatalogo = Math.round(base.pvp * (base.porcentajeDescuentoEditorial / 100));
  const ahora = new Date().toISOString();
  return {
    ...base,
    costo,
    utilidadCatalogo,
    cantidadDisponible: base.cantidadTotal,
    creadoPor: 'demo@letiende.co',
    creadoEn: ahora,
    actualizadoEn: ahora,
  };
}

const LIBROS_DEMO = [
  calcularLibro({
    bookId: 'demo-1',
    isbn: '9780307474728',
    titulo: 'Cien años de soledad',
    autor: 'Gabriel García Márquez',
    editorial: 'Sudamericana',
    portadaUrl: null,
    pvp: 55000,
    porcentajeDescuentoEditorial: 35,
    cantidadTotal: 3,
    estanteId: 'estante-1',
  }),
  calcularLibro({
    bookId: 'demo-2',
    isbn: '9788437604572',
    titulo: 'Rayuela',
    autor: 'Julio Cortázar',
    editorial: 'Alfaguara',
    portadaUrl: null,
    pvp: 48000,
    porcentajeDescuentoEditorial: 35,
    cantidadTotal: 2,
    estanteId: 'estante-1',
  }),
  calcularLibro({
    bookId: 'demo-3',
    isbn: '9788420633292',
    titulo: 'El Aleph',
    autor: 'Jorge Luis Borges',
    editorial: 'Alianza Editorial',
    portadaUrl: null,
    pvp: 42000,
    porcentajeDescuentoEditorial: 35,
    cantidadTotal: 4,
    estanteId: 'estante-2',
  }),
];

async function main() {
  const tablaLibros = requerirEnv('TABLA_LIBROS');
  const region = process.env['AWS_REGION'] ?? requerirEnv('AWS_DEFAULT_REGION');
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  for (const libro of LIBROS_DEMO) {
    await dynamo.send(new PutCommand({ TableName: tablaLibros, Item: libro }));
    console.log(`✅ Sembrado en ${tablaLibros}: ${libro.bookId} — "${libro.titulo}" (${libro.autor})`);
  }
}

main().catch((error) => {
  console.error('✘ Falló sembrar-libros-demo:', error);
  process.exit(1);
});
