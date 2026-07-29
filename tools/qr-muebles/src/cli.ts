import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { obtenerEspacios, obtenerMuebles } from './dynamo';
import { generarEstampillaPng, construirUrlCatalogo } from './generador';
import { componerPdf } from './pdf';
import { verificarQrDecodifica } from './verificacion';
import type { Espacio, Mueble } from './tipos';

const DIAMETRO_MM_DEFECTO = 80;
const SALIDA_DEFECTO = 'salida/estampillas-qr.pdf';
const STAGE_DEFECTO = 'staging';
const PLANTILLA_DEFECTO = 'plantillas/estampilla.svg';

function parsearArgumentos() {
  const { values } = parseArgs({
    options: {
      stage: { type: 'string', default: STAGE_DEFECTO },
      diametro: { type: 'string', default: String(DIAMETRO_MM_DEFECTO) },
      salida: { type: 'string', default: SALIDA_DEFECTO },
      plantilla: { type: 'string', default: PLANTILLA_DEFECTO },
      'sin-logo': { type: 'boolean', default: false },
    },
  });

  const diametroMm = Number(values.diametro);
  if (!Number.isFinite(diametroMm) || diametroMm <= 0) {
    throw new Error(`El valor de --diametro debe ser un número positivo (recibido: "${values.diametro}").`);
  }

  return {
    stage: values.stage as string,
    diametroMm,
    salida: values.salida as string,
    rutaPlantilla: values.plantilla as string,
    incluirLogo: !(values['sin-logo'] as boolean),
  };
}

/** Mensaje amigable en español para errores comunes de credenciales AWS. */
function mensajeErrorAmigable(error: unknown): string {
  const nombre = error instanceof Error ? error.name : '';
  const mensaje = error instanceof Error ? error.message : String(error);

  if (
    nombre.includes('CredentialsProviderError') ||
    /credential/i.test(mensaje) ||
    /could not load credentials/i.test(mensaje)
  ) {
    return "No se pudieron obtener credenciales de AWS. Verifica que el perfil 'default' de ~/.aws/config esté configurado (región us-east-1).";
  }

  if (nombre === 'UnrecognizedClientException' || nombre === 'InvalidSignatureException') {
    return 'Las credenciales de AWS configuradas no son válidas. Verifica el perfil "default" de ~/.aws/config.';
  }

  if (nombre === 'ResourceNotFoundException') {
    return `No se encontró alguna de las tablas DynamoDB esperadas para este stage. Verifica que las tablas 'babel-espacios-*' y 'babel-muebles-*' existan. Detalle: ${mensaje}`;
  }

  if (nombre === 'AccessDeniedException') {
    return 'El perfil "default" de AWS no tiene permisos suficientes para leer las tablas DynamoDB de Babel.';
  }

  // Errores de validación de la plantilla (plantilla.ts) ya vienen con un
  // mensaje claro y accionable en español — se muestran tal cual, sin el
  // prefijo genérico de "error inesperado".
  if (/^La plantilla "/.test(mensaje) || /^El (viewBox|elemento) /.test(mensaje)) {
    return mensaje;
  }

  return `Ocurrió un error inesperado: ${mensaje}`;
}

async function main(): Promise<void> {
  const { stage, diametroMm, salida, rutaPlantilla, incluirLogo } = parsearArgumentos();

  console.log(
    `Generando estampillas QR — stage: ${stage}, diámetro: ${diametroMm}mm, plantilla: ${rutaPlantilla}, logo: ${incluirLogo ? 'sí' : 'no'}`,
  );

  const [espacios, muebles]: [Espacio[], Mueble[]] = await Promise.all([
    obtenerEspacios(stage),
    obtenerMuebles(stage),
  ]);

  console.log(`Espacios encontrados: ${espacios.length}`);
  console.log(`Muebles encontrados: ${muebles.length}`);

  const espaciosPorId = new Map(espacios.map((espacio) => [espacio.espacioId, espacio]));

  const mueblesValidos: { espacio: Espacio; mueble: Mueble }[] = [];
  for (const mueble of muebles) {
    const espacio = espaciosPorId.get(mueble.espacioId);
    if (!espacio) {
      console.warn(
        `Aviso: el mueble "${mueble.nombre}" (${mueble.muebleId}) referencia un espacio inexistente (${mueble.espacioId}) — se omite.`,
      );
      continue;
    }
    mueblesValidos.push({ espacio, mueble });
  }

  console.log(`Estampillas a generar: ${mueblesValidos.length}`);

  const pngs: Buffer[] = [];
  const fallasDeEscaneo: { espacio: Espacio; mueble: Mueble }[] = [];
  for (const { espacio, mueble } of mueblesValidos) {
    const png = await generarEstampillaPng(espacio, mueble, diametroMm, rutaPlantilla, incluirLogo);
    pngs.push(png);

    // Verificación automática: decodifica el PNG recién generado y confirma
    // que el QR corresponde exactamente a la URL esperada. Este chequeo
    // existe porque un bug real de escaneabilidad (ver README) se coló dos
    // veces sin que la revisión visual lo detectara — solo un decodificador
    // de verdad lo atrapa. No bloquea la corrida (las demás estampillas SÍ
    // pueden ser válidas) pero avisa fuerte cuál mueble necesita atención.
    const urlEsperada = construirUrlCatalogo(espacio, mueble);
    if (!verificarQrDecodifica(png, urlEsperada)) {
      fallasDeEscaneo.push({ espacio, mueble });
      console.warn(
        `⚠️  AVISO DE ESCANEO: el QR de "${espacio.nombre} / ${mueble.nombre}" (${mueble.muebleId}) NO decodificó correctamente en la verificación automática. Revisa esta estampilla antes de imprimirla — puede no ser escaneable.`,
      );
    }
  }

  const pdfBytes = await componerPdf(pngs, diametroMm);

  await mkdir(dirname(salida), { recursive: true });
  await writeFile(salida, pdfBytes);

  console.log(`PDF generado en: ${salida}`);

  if (fallasDeEscaneo.length > 0) {
    console.warn('');
    console.warn(
      `⚠️  ${fallasDeEscaneo.length} de ${mueblesValidos.length} estampilla(s) NO pasaron la verificación automática de escaneo:`,
    );
    for (const { espacio, mueble } of fallasDeEscaneo) {
      console.warn(`   - ${espacio.nombre} / ${mueble.nombre} (${mueble.muebleId})`);
    }
    console.warn('   Igual quedaron incluidas en el PDF — revísalas antes de imprimir el lote completo.');
  } else {
    console.log(`Verificación de escaneo: las ${mueblesValidos.length} estampilla(s) decodificaron correctamente.`);
  }
}

main().catch((error: unknown) => {
  console.error(mensajeErrorAmigable(error));
  process.exitCode = 1;
});
