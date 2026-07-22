import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { obtenerMetadatosPorIsbn } from '../services/api-letiende';
import { obtenerPorClave, escanearTodo } from '../services/dynamodb';
import { scrapearSitio, type SitioScraping } from '../services/scraping';

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que `estantes.ts`/`usuarios-me.ts`. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}

/**
 * Contrato de salida de `GET /api/metadatos/:isbn` (`TODO.md`, Tarea 1 —
 * Task C): `MetadatosLibro` (`api-letiende.ts`) + `pvp`, que `api.letiende.co`
 * nunca resuelve (Google Books no maneja precios) y que solo puede llegar
 * por scraping. Se define aquí, en el handler, en vez de tocar
 * `MetadatosLibro` — ese tipo sigue representando exclusivamente lo que
 * `api.letiende.co` puede dar.
 */
interface MetadatosCompletos {
  titulo: string | null;
  autor: string | null;
  editorial: string | null;
  portadaUrl: string | null;
  pvp: number | null;
}

function respuestaJson(statusCode: number, cuerpo: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

function nombreTablaUsuarios(): string {
  const nombre = process.env['TABLA_USUARIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_USUARIOS.');
  }
  return nombre;
}

function nombreTablaSitiosScraping(): string {
  const nombre = process.env['TABLA_SITIOS_SCRAPING'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_SITIOS_SCRAPING.');
  }
  return nombre;
}

/**
 * Orquesta `obtenerMetadatosPorIsbn` (`api.letiende.co`, siempre primero) con
 * el fallback de scraping (`plan-obtencion-info-libros.md` §6 Task C):
 *
 *   1. `api.letiende.co` resuelve título/autor/editorial/portada si puede.
 *      Nunca resuelve `pvp` — por eso el scraping para `pvp` se dispara
 *      prácticamente siempre, incluso si el resto de campos ya llegó
 *      completo.
 *   2. Si sigue faltando algún campo de info o el `pvp`, se leen los sitios
 *      de `babel-sitios-scraping` y se llama `scrapearSitio` para TODOS los
 *      sitios "aplicables" **en paralelo** (`Promise.all`) — nunca secuencial
 *      por prioridad: cada llamada puede tardar hasta ~16s (`TIMEOUT_MS` de
 *      `scraping.ts` con las 2 peticiones internas de Tornamesa), así que
 *      iterar secuencialmente podría superar los 30s con 4 sitios semilla.
 *      Un sitio es aplicable si tiene `info=true` (mientras falte info) o
 *      `pvp=true` (mientras falte pvp).
 *   3. Los resultados se fusionan respetando `prioridad` ascendente como
 *      criterio de desempate — se ordenan DESPUÉS de que todas las promesas
 *      resuelven, así que el orden de llegada de red nunca decide. Un campo
 *      que `api.letiende.co` ya resolvió jamás se sobrescribe.
 *
 * Nunca lanza: si `babel-sitios-scraping` está vacía o el `Scan` falla,
 * degrada a lo que ya se tenía de `api.letiende.co` (mismo criterio "nunca
 * lanza" del resto del proyecto, CLAUDE.md A08).
 */
async function resolverMetadatosCompletos(isbn: string): Promise<MetadatosCompletos> {
  const infoBase = await obtenerMetadatosPorIsbn(isbn);
  const resultado: MetadatosCompletos = { ...infoBase, pvp: null };

  const faltaInfo = resultado.titulo === null || resultado.autor === null
    || resultado.editorial === null || resultado.portadaUrl === null;
  const faltaPvp = resultado.pvp === null;

  if (!faltaInfo && !faltaPvp) {
    return resultado;
  }

  let sitios: SitioScraping[];
  try {
    sitios = await escanearTodo<SitioScraping>(nombreTablaSitiosScraping());
  } catch (error) {
    console.error(
      `resolverMetadatosCompletos: falló el Scan de babel-sitios-scraping para isbn=${isbn}, se degrada a solo api.letiende.co`,
      error,
    );
    return resultado;
  }

  const sitiosAplicables = sitios.filter(
    (sitio) => (faltaInfo && sitio.info) || (faltaPvp && sitio.pvp),
  );
  if (sitiosAplicables.length === 0) {
    return resultado;
  }

  // En paralelo — cada resultado se empareja con su `sitio` de origen para
  // poder ordenar por `prioridad` después, sin importar en qué orden
  // resolvieron las promesas.
  const resultadosScraping = await Promise.all(
    sitiosAplicables.map(async (sitio) => ({ sitio, resultado: await scrapearSitio(sitio, isbn) })),
  );
  resultadosScraping.sort((a, b) => a.sitio.prioridad - b.sitio.prioridad);

  for (const { resultado: resultadoSitio } of resultadosScraping) {
    if (resultado.titulo === null && resultadoSitio.titulo) {
      resultado.titulo = resultadoSitio.titulo;
    }
    if (resultado.autor === null && resultadoSitio.autor) {
      resultado.autor = resultadoSitio.autor;
    }
    if (resultado.editorial === null && resultadoSitio.editorial) {
      resultado.editorial = resultadoSitio.editorial;
    }
    if (resultado.portadaUrl === null && resultadoSitio.portadaUrl) {
      resultado.portadaUrl = resultadoSitio.portadaUrl;
    }
    if (resultado.pvp === null && resultadoSitio.pvp !== undefined) {
      resultado.pvp = resultadoSitio.pvp;
    }
  }

  return resultado;
}

/**
 * `GET /api/metadatos/:isbn` — autocompleta título/autor/editorial/portada/pvp
 * al catalogar un libro, combinando la API externa `api.letiende.co`
 * (`server/api/services/api-letiende.ts`) con el fallback de scraping en
 * paralelo (`resolverMetadatosCompletos`, arriba). Exige rol `vendedor` **o**
 * `administrador`, mismo criterio que `GET /api/estantes`: es de solo
 * lectura, sin datos sensibles, y un vendedor lo necesita en el flujo
 * normal de catalogación.
 *
 * Siempre responde `200` — con los campos en `null` si no se encontró nada
 * en ninguna fuente. "No encontrado" es un resultado válido del flujo
 * (PRD.md §5.2, "el vendedor los completa manualmente"), nunca un error que
 * deba bloquear ni alarmar (CLAUDE.md A08).
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const { email } = await verificarTokenDesdeHeader(event.headers['authorization']);

    const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
    if (usuario?.rol !== 'vendedor' && usuario?.rol !== 'administrador') {
      return respuestaJson(403, { error: 'Este correo no está autorizado para consultar metadatos en Babel.' });
    }

    const isbn = event.pathParameters?.['isbn'];
    if (!isbn) {
      return respuestaJson(400, { error: 'Falta el isbn en la ruta.' });
    }

    const metadatos = await resolverMetadatosCompletos(isbn);
    return respuestaJson(200, metadatos);
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
