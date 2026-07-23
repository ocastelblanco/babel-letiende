/**
 * Motor de scraping por ISBN contra los sitios semilla de `babel-sitios-scraping`
 * (`plan-obtencion-info-libros.md` §6 Task B, ADR-010/ADR-011, `TODO.md`
 * Tarea 1). Dos responsabilidades:
 *
 *   1. La guardia SSRF fija (`esUrlSegura` + `fetchSeguro`, ADR-011): protege
 *      TODA petición saliente sin importar lo que el administrador haya
 *      agregado a la lista de sitios (CLAUDE.md A10). Exige `https:`,
 *      resuelve DNS de verdad (para prevenir "DNS rebinding") y rechaza
 *      rangos privados/loopback/link-local, incluyendo explícitamente el
 *      metadata service de AWS (`169.254.169.254`). Las redirecciones se
 *      siguen manualmente (`redirect: 'manual'`), revalidando el host de
 *      cada salto — defensa en profundidad aplicada a todas las peticiones,
 *      incluidas las de "mismo dominio" (ej. Tornamesa paso 2).
 *
 *   2. Los 4 adaptadores por `dominio` (Librería Lerner, Librería Nacional,
 *      Tornamesa, Busca Libre): cada uno extrae solo texto/números planos
 *      (nunca HTML crudo — CLAUDE.md A03) desde el JSON/HTML del sitio.
 *
 * `scrapearSitio` es la única función pública de consumo externo: dado un
 * `SitioScraping` (política, ADR-010) y un ISBN, invoca el adaptador que
 * corresponda a `sitio.dominio`. NUNCA lanza — cualquier fallo (red,
 * parseo, SSRF rechazado, timeout, dominio sin adaptador) degrada a "no
 * encontrado" (mismo criterio que `api-letiende.ts`). No decide qué campos
 * usar según las banderas `info`/`pvp` — eso es responsabilidad del
 * llamador (Task C, integración en `/api/metadatos/:isbn`, fuera de esta
 * tarea).
 */

import dns from 'node:dns';
import * as cheerio from 'cheerio';
import type { CandidatoLibro } from './api-letiende';

/** Copia local de `src/app/core/models/sitio-scraping.model.ts` — mismo motivo que en los handlers (ver `sitios-scraping.ts`). Solo se lee `dominio`, pero se copia la forma completa por consistencia con el resto del backend. */
export interface SitioScraping {
  dominio: string;
  nombre: string;
  url: string;
  info: boolean;
  pvp: boolean;
  prioridad: number;
}

/** Lo que un adaptador logra extraer de un sitio — todos los campos son opcionales porque cualquier extracción puede fallar de forma parcial sin que eso sea un error. */
export interface ResultadoScraping {
  titulo?: string;
  autor?: string;
  editorial?: string;
  portadaUrl?: string;
  pvp?: number;
}

const RESULTADO_VACIO: ResultadoScraping = {};

/** Techo de sanidad para el PVP (CLAUDE.md A08) — misma regla que `catalogar-libro.component.ts`/`libros.ts`, redefinida aquí porque no es fácilmente importable entre frontend/backend/este servicio. */
const PVP_MAXIMO = 5_000_000;

const TIMEOUT_MS = 8000;
const MAX_REDIRECCIONES = 3;

// ---------------------------------------------------------------------------
// Guardia SSRF (ADR-011)
// ---------------------------------------------------------------------------

function ipv4AEntero(ip: string): number | null {
  const partes = ip.split('.');
  if (partes.length !== 4) {
    return null;
  }
  let entero = 0;
  for (const parte of partes) {
    const n = Number(parte);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null;
    }
    entero = (entero << 8) | n;
  }
  return entero >>> 0;
}

function enRangoIpv4(ip: string, base: string, bits: number): boolean {
  const ipEntero = ipv4AEntero(ip);
  const baseEntero = ipv4AEntero(base);
  if (ipEntero === null || baseEntero === null) {
    return false;
  }
  const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipEntero & mascara) === (baseEntero & mascara);
}

/** Rangos privados/loopback/link-local IPv4 a rechazar (ADR-011) — incluye explícitamente 169.254.169.254 (metadata service de AWS), cubierto por 169.254.0.0/16. */
const RANGOS_IPV4_PROHIBIDOS: Array<{ base: string; bits: number }> = [
  { base: '10.0.0.0', bits: 8 },
  { base: '172.16.0.0', bits: 12 },
  { base: '192.168.0.0', bits: 16 },
  { base: '127.0.0.0', bits: 8 },
  { base: '169.254.0.0', bits: 16 },
];

function esIpv4Prohibida(ip: string): boolean {
  return RANGOS_IPV4_PROHIBIDOS.some((rango) => enRangoIpv4(ip, rango.base, rango.bits));
}

/** Equivalentes IPv6 (ADR-011): `::1` (loopback), `fc00::/7` (ULA/local privada) y `fe80::/10` (link-local). */
function esIpv6Prohibida(ip: string): boolean {
  const normalizada = ip.toLowerCase();
  if (normalizada === '::1') {
    return true;
  }
  const mapeadoIpv4 = normalizada.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeadoIpv4) {
    return esIpv4Prohibida(mapeadoIpv4[1]);
  }
  const primerHextet = parseInt(normalizada.split(':')[0] || '', 16);
  if (!Number.isNaN(primerHextet)) {
    if (primerHextet >= 0xfc00 && primerHextet <= 0xfdff) {
      return true; // fc00::/7
    }
    if (primerHextet >= 0xfe80 && primerHextet <= 0xfebf) {
      return true; // fe80::/10
    }
  }
  return false;
}

function esIpProhibida(ip: string): boolean {
  return ip.includes(':') ? esIpv6Prohibida(ip) : esIpv4Prohibida(ip);
}

/**
 * Guardia SSRF fija (ADR-011): exige `https:`, resuelve DNS de verdad (nunca
 * confía solo en el string del hostname, para prevenir "DNS rebinding") y
 * rechaza si CUALQUIERA de las IPs resueltas cae en un rango privado/
 * loopback/link-local. Nunca asume seguro por defecto: cualquier fallo de
 * parseo/resolución devuelve `false`.
 */
export async function esUrlSegura(url: string): Promise<boolean> {
  let parseada: URL;
  try {
    parseada = new URL(url);
  } catch {
    return false;
  }

  if (parseada.protocol !== 'https:') {
    return false;
  }

  const hostname = parseada.hostname.replace(/^\[|\]$/g, '');

  try {
    const resultados = await dns.promises.lookup(hostname, { all: true });
    if (resultados.length === 0) {
      return false;
    }
    return resultados.every((resultado) => !esIpProhibida(resultado.address));
  } catch {
    return false;
  }
}

/**
 * `fetch` seguro: valida `esUrlSegura` ANTES de cada petición real —
 * incluida la inicial y cualquier redirección. Usa `redirect: 'manual'` y
 * revalida manualmente cada salto (hasta `MAX_REDIRECCIONES`) en vez de
 * confiar en el `redirect: 'follow'` nativo, que seguiría el `Location` sin
 * pasar por la guardia. Nunca lanza: cualquier fallo (SSRF rechazado, red,
 * timeout, demasiadas redirecciones) devuelve `null`.
 */
async function fetchSeguro(url: string, intentosRestantes = MAX_REDIRECCIONES): Promise<Response | null> {
  if (!(await esUrlSegura(url))) {
    return null;
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }

  if (respuesta.status >= 300 && respuesta.status < 400) {
    const ubicacion = respuesta.headers.get('location');
    if (!ubicacion || intentosRestantes <= 0) {
      return null;
    }
    let urlAbsoluta: string;
    try {
      urlAbsoluta = new URL(ubicacion, url).toString();
    } catch {
      return null;
    }
    return fetchSeguro(urlAbsoluta, intentosRestantes - 1);
  }

  if (!respuesta.ok) {
    return null;
  }

  return respuesta;
}

// ---------------------------------------------------------------------------
// Parseo de precio (regla única, ver TODO.md Tarea 1)
// ---------------------------------------------------------------------------

function validarPvp(valor: number | undefined): number | undefined {
  if (valor === undefined || !Number.isFinite(valor) || valor <= 0 || valor > PVP_MAXIMO) {
    return undefined;
  }
  return valor;
}

/**
 * Parsea un precio expresado como string ruidoso de schema.org (ej.
 * `"78000.00"` o `"120.000.00"`, con separadores de miles inconsistentes y
 * siempre 2 dígitos de "centavos" al final): elimina todo lo que no sea
 * dígito y divide entre 100. Usado por Tornamesa y Busca Libre.
 */
function parsearPrecioConCentavos(valor: string | undefined): number | undefined {
  if (valor === undefined) {
    return undefined;
  }
  const soloDigitos = valor.replace(/\D/g, '');
  if (soloDigitos === '') {
    return undefined;
  }
  return validarPvp(parseInt(soloDigitos, 10) / 100);
}

/** Precio plano de la API VTEX (ej. `120000.0`) — no necesita quitar "centavos", solo redondear. */
function parsearPrecioPlano(valor: number | undefined): number | undefined {
  if (valor === undefined) {
    return undefined;
  }
  return validarPvp(Math.round(valor));
}

// ---------------------------------------------------------------------------
// Adaptador VTEX compartido — Librería Lerner y Librería Nacional
// ---------------------------------------------------------------------------

interface ProductoVtex {
  productName?: string;
  brand?: string;
  items?: Array<{
    /** ISBN "sucio" — trae un sufijo de SKU de tienda (ej. `"9786287638716-1585"`), ver `extraerIsbnDeEan`. */
    ean?: string;
    images?: Array<{ imageUrl?: string }>;
    sellers?: Array<{ commertialOffer?: { Price?: number } }>;
  }>;
  [campo: string]: unknown;
}

interface OpcionesVtex {
  /** Nombre exacto del campo de autor en la respuesta VTEX — difiere entre sitios (Lerner: "Autor", Nacional: "Autor(es)", con paréntesis literales). */
  campoAutor: 'Autor' | 'Autor(es)';
  /** Nombre del campo de editorial, o `null` si el sitio no lo expone (Nacional) — en ese caso se usa `brand` como respaldo. */
  campoEditorial: 'Editorial' | null;
}

/** Adaptador compartido por la API pública VTEX de Lerner y Nacional — mismo formato de respuesta, solo cambian los nombres de campo (`OpcionesVtex`). */
async function consultarApiVtex(urlBase: string, isbn: string, opciones: OpcionesVtex): Promise<ResultadoScraping> {
  const url = `${urlBase}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(isbn)}`;
  const respuesta = await fetchSeguro(url);
  if (!respuesta) {
    return RESULTADO_VACIO;
  }

  let cuerpo: ProductoVtex[];
  try {
    cuerpo = (await respuesta.json()) as ProductoVtex[];
  } catch {
    return RESULTADO_VACIO;
  }

  const producto = cuerpo[0];
  if (!producto) {
    return RESULTADO_VACIO;
  }

  const autorArray = producto[opciones.campoAutor] as string[] | undefined;
  const editorialArray = opciones.campoEditorial
    ? (producto[opciones.campoEditorial] as string[] | undefined)
    : undefined;
  const item = producto.items?.[0];

  return {
    titulo: producto.productName,
    autor: autorArray?.[0],
    editorial: editorialArray?.[0] ?? producto.brand,
    portadaUrl: item?.images?.[0]?.imageUrl,
    pvp: parsearPrecioPlano(item?.sellers?.[0]?.commertialOffer?.Price),
  };
}

async function scrapearLerner(isbn: string): Promise<ResultadoScraping> {
  return consultarApiVtex('https://www.librerialerner.com.co', isbn, {
    campoAutor: 'Autor',
    campoEditorial: 'Editorial',
  });
}

async function scrapearNacional(isbn: string): Promise<ResultadoScraping> {
  return consultarApiVtex('https://www.librerianacional.com', isbn, {
    campoAutor: 'Autor(es)',
    campoEditorial: null,
  });
}

// ---------------------------------------------------------------------------
// Búsqueda por texto (título/autor) — Librería Lerner y Librería Nacional
// (TODO.md, Tarea de búsqueda por título/autor)
// ---------------------------------------------------------------------------

/**
 * Extrae el ISBN limpio del campo `ean` de un producto VTEX — gotcha
 * confirmado en vivo: `ean` trae un sufijo de SKU de tienda (ej.
 * `"9786287638716-1585"`), no un ISBN limpio. Solo se acepta el prefijo si,
 * una vez aislado por el primer `-`, tiene exactamente 13 dígitos —
 * cualquier otra forma se descarta como "sin ISBN" en vez de arriesgar un
 * dato incorrecto (mismo criterio de `validarPvp`: ante la duda, `null`).
 */
function extraerIsbnDeEan(ean: string | undefined): string | null {
  if (!ean) {
    return null;
  }
  const prefijo = ean.split('-')[0] ?? '';
  return /^\d{13}$/.test(prefijo) ? prefijo : null;
}

/**
 * Búsqueda de texto libre contra la misma API pública VTEX que
 * `consultarApiVtex` — confirmado en vivo que el endpoint `ft=` soporta
 * consultas multi-palabra, no solo ISBN. VTEX no separa `titulo`/`autor` en
 * parámetros distintos, así que ambos se combinan en un solo string `ft=`. A
 * diferencia de `consultarApiVtex` (que solo usa `cuerpo[0]`, un único
 * producto exacto), aquí se devuelven TODOS los productos como candidatos —
 * el vendedor elige visualmente.
 *
 * Gotcha confirmado en vivo: si la query multi-palabra se codifica con `+`
 * en vez de `%20` para los espacios, el WAF del sitio la rechaza con
 * `400 Bad Request! Scripts are not allowed!`. Por eso se usa
 * `encodeURIComponent` explícito (codifica espacios como `%20`, igual que
 * `consultarApiVtex`) en vez de `URLSearchParams`, cuyo serializador usa `+`.
 *
 * Nunca lanza — cualquier fallo (red, SSRF rechazado, parseo, sin `titulo`
 * ni `autor`) degrada a `[]`, mismo criterio que el resto de este archivo.
 */
/** Combina `titulo`/`autor` en el único string `ft=` que acepta VTEX (no separa parámetros) — compartido por la búsqueda de candidatos y la de PVP. Cadena vacía si ninguno de los dos viene. */
function construirQueryVtex(titulo: string | null, autor: string | null): string {
  return [titulo, autor]
    .filter((valor): valor is string => !!valor && valor.trim() !== '')
    .map((valor) => valor.trim())
    .join(' ');
}

/**
 * Fetch + parseo compartido de la búsqueda de texto libre VTEX — usado por
 * `buscarEnVtexPorTexto` (candidatos completos) y `buscarPvpEnVtexPorTexto`
 * (solo precio del primer resultado). Nunca lanza: cualquier fallo (sin
 * query, red, SSRF rechazado, parseo) devuelve `[]`.
 */
async function buscarProductosVtexPorTexto(
  urlBase: string,
  titulo: string | null,
  autor: string | null,
): Promise<ProductoVtex[]> {
  const query = construirQueryVtex(titulo, autor);
  if (query === '') {
    return [];
  }

  const url = `${urlBase}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
  const respuesta = await fetchSeguro(url);
  if (!respuesta) {
    return [];
  }

  try {
    return (await respuesta.json()) as ProductoVtex[];
  } catch {
    return [];
  }
}

async function buscarEnVtexPorTexto(
  urlBase: string,
  titulo: string | null,
  autor: string | null,
  opciones: OpcionesVtex,
): Promise<CandidatoLibro[]> {
  const cuerpo = await buscarProductosVtexPorTexto(urlBase, titulo, autor);

  const candidatos: CandidatoLibro[] = [];
  for (const producto of cuerpo) {
    if (!producto.productName) {
      continue;
    }
    const autorArray = producto[opciones.campoAutor] as string[] | undefined;
    const editorialArray = opciones.campoEditorial
      ? (producto[opciones.campoEditorial] as string[] | undefined)
      : undefined;
    const item = producto.items?.[0];

    candidatos.push({
      titulo: producto.productName,
      autor: autorArray?.[0] ?? null,
      editorial: editorialArray?.[0] ?? producto.brand ?? null,
      portadaUrl: item?.images?.[0]?.imageUrl ?? null,
      isbn: extraerIsbnDeEan(item?.ean),
    });
  }

  return candidatos;
}

export async function buscarLernerPorTexto(titulo: string | null, autor: string | null): Promise<CandidatoLibro[]> {
  return buscarEnVtexPorTexto('https://www.librerialerner.com.co', titulo, autor, {
    campoAutor: 'Autor',
    campoEditorial: 'Editorial',
  });
}

export async function buscarNacionalPorTexto(titulo: string | null, autor: string | null): Promise<CandidatoLibro[]> {
  return buscarEnVtexPorTexto('https://www.librerianacional.com', titulo, autor, {
    campoAutor: 'Autor(es)',
    campoEditorial: null,
  });
}

/**
 * PVP del primer resultado (mejor match) de una búsqueda de texto libre en
 * la API pública VTEX — usado para resolver el PVP de un candidato SIN ISBN
 * elegido en la búsqueda por título/autor (`metadatos.ts`,
 * `buscarPvpPorTexto`). A diferencia de `buscarEnVtexPorTexto` (que arma
 * toda la lista de candidatos), aquí solo interesa el precio del primero.
 * Nunca lanza — cualquier fallo o ausencia de precio devuelve `null`.
 */
async function buscarPvpEnVtexPorTexto(
  urlBase: string,
  titulo: string | null,
  autor: string | null,
): Promise<number | null> {
  const cuerpo = await buscarProductosVtexPorTexto(urlBase, titulo, autor);
  const item = cuerpo[0]?.items?.[0];
  return parsearPrecioPlano(item?.sellers?.[0]?.commertialOffer?.Price) ?? null;
}

export async function buscarPvpEnLernerPorTexto(titulo: string | null, autor: string | null): Promise<number | null> {
  return buscarPvpEnVtexPorTexto('https://www.librerialerner.com.co', titulo, autor);
}

export async function buscarPvpEnNacionalPorTexto(titulo: string | null, autor: string | null): Promise<number | null> {
  return buscarPvpEnVtexPorTexto('https://www.librerianacional.com', titulo, autor);
}

// ---------------------------------------------------------------------------
// Adaptador Tornamesa — búsqueda HTML (paso 1) + JSON-LD de producto (paso 2)
// ---------------------------------------------------------------------------

/** Busca, entre los bloques `<script type="application/ld+json">` de `html`, el primero cuyo `@type` sea `tipoBuscado`. Nunca devuelve HTML crudo: solo el objeto ya parseado (CLAUDE.md A03). */
function buscarJsonLdPorTipo(html: string, tipoBuscado: string): Record<string, unknown> | undefined {
  const $ = cheerio.load(html);
  let encontrado: Record<string, unknown> | undefined;
  $('script[type="application/ld+json"]').each((_indice, elemento) => {
    if (encontrado) {
      return;
    }
    try {
      const json = JSON.parse($(elemento).html() ?? '') as Record<string, unknown>;
      if (json && json['@type'] === tipoBuscado) {
        encontrado = json;
      }
    } catch {
      // Bloque JSON-LD inválido o irrelevante — se ignora, no es un error.
    }
  });
  return encontrado;
}

function comoString(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Búsqueda en Tornamesa (HTML, 2 peticiones: listado + producto) — recibe
 * cualquier texto de búsqueda, no solo ISBN: confirmado en vivo que
 * `palabrasBusqueda=` acepta consultas multi-palabra igual que un ISBN
 * (mismo endpoint). Compartida por `scrapearTornamesa` (por ISBN) y
 * `buscarPvpEnTornamesaPorTexto` (por título/autor, fallback de PVP).
 */
async function consultarTornamesa(query: string): Promise<ResultadoScraping> {
  const urlBusqueda = `https://www.tornamesa.co/busqueda/listaLibros.php?tipoBus=full&palabrasBusqueda=${encodeURIComponent(query)}`;
  const respuestaBusqueda = await fetchSeguro(urlBusqueda);
  if (!respuestaBusqueda) {
    return RESULTADO_VACIO;
  }

  let htmlBusqueda: string;
  try {
    htmlBusqueda = await respuestaBusqueda.text();
  } catch {
    return RESULTADO_VACIO;
  }

  const $busqueda = cheerio.load(htmlBusqueda);
  const linkRelativo = $busqueda('a[href^="/libro/"]').first().attr('href');
  if (!linkRelativo) {
    return RESULTADO_VACIO;
  }

  let urlProducto: string;
  try {
    urlProducto = new URL(linkRelativo, 'https://www.tornamesa.co').toString();
  } catch {
    return RESULTADO_VACIO;
  }

  // Segunda petición — mismo dominio, pero pasa por la guardia SSRF igual
  // que cualquier otra (defensa en profundidad, ADR-011).
  const respuestaProducto = await fetchSeguro(urlProducto);
  if (!respuestaProducto) {
    return RESULTADO_VACIO;
  }

  let htmlProducto: string;
  try {
    htmlProducto = await respuestaProducto.text();
  } catch {
    return RESULTADO_VACIO;
  }

  const datosLibro = buscarJsonLdPorTipo(htmlProducto, 'Book');
  if (!datosLibro) {
    return RESULTADO_VACIO;
  }

  const ofertas = datosLibro['offers'] as { price?: string } | undefined;

  return {
    titulo: comoString(datosLibro['name']),
    autor: comoString(datosLibro['author']),
    editorial: comoString(datosLibro['publisher']),
    portadaUrl: comoString(datosLibro['image']),
    pvp: parsearPrecioConCentavos(ofertas?.price),
  };
}

async function scrapearTornamesa(isbn: string): Promise<ResultadoScraping> {
  return consultarTornamesa(isbn);
}

/**
 * PVP en Tornamesa buscando por título/autor — último recurso de
 * `buscarPvpPorTexto` (`metadatos.ts`) cuando ni Lerner ni Nacional
 * resolvieron precio para un candidato SIN ISBN: 2 peticiones HTML
 * (listado + producto) en vez de 1 llamada JSON, por eso solo se intenta
 * si las otras dos fuentes ya fallaron. Nunca lanza — sin resultado
 * devuelve `null`.
 */
export async function buscarPvpEnTornamesaPorTexto(titulo: string | null, autor: string | null): Promise<number | null> {
  const query = construirQueryVtex(titulo, autor);
  if (query === '') {
    return null;
  }
  const resultado = await consultarTornamesa(query);
  return resultado.pvp ?? null;
}

// ---------------------------------------------------------------------------
// Adaptador Busca Libre — JSON-LD de producto (con redirección de búsqueda)
// ---------------------------------------------------------------------------

async function scrapearBuscaLibre(isbn: string): Promise<ResultadoScraping> {
  const urlBusqueda = `https://www.buscalibre.com.co/libros/search?q=${encodeURIComponent(isbn)}`;
  // `fetchSeguro` sigue la redirección (302/301) hacia la página de producto
  // revalidando el host destino antes de seguirla — no se usa
  // `redirect: 'follow'` nativo (ver comentario en `fetchSeguro`).
  const respuesta = await fetchSeguro(urlBusqueda);
  if (!respuesta) {
    return RESULTADO_VACIO;
  }

  let html: string;
  try {
    html = await respuesta.text();
  } catch {
    return RESULTADO_VACIO;
  }

  const datosProducto = buscarJsonLdPorTipo(html, 'Product');
  if (!datosProducto) {
    return RESULTADO_VACIO;
  }

  const autor = datosProducto['author'] as { name?: unknown } | undefined;
  const editorial = datosProducto['publisher'] as { name?: unknown } | undefined;
  const ofertas = datosProducto['offers'] as Array<{ price?: string }> | undefined;

  return {
    titulo: comoString(datosProducto['name']),
    autor: comoString(autor?.name),
    editorial: comoString(editorial?.name),
    portadaUrl: comoString(datosProducto['image']),
    pvp: parsearPrecioConCentavos(ofertas?.[0]?.price),
  };
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

const ADAPTADORES_POR_DOMINIO: Record<string, (isbn: string) => Promise<ResultadoScraping>> = {
  'www.librerialerner.com.co': scrapearLerner,
  'www.librerianacional.com': scrapearNacional,
  'www.tornamesa.co': scrapearTornamesa,
  'www.buscalibre.com.co': scrapearBuscaLibre,
};

/**
 * Extrae lo que se pueda de `sitio` (según `sitio.dominio`) para `isbn`.
 * Devuelve TODO lo que logró extraer — no filtra por las banderas
 * `info`/`pvp` de `sitio` (responsabilidad del llamador, Task C). Si el
 * dominio no tiene adaptador de código, se "registra y se omite" (ADR-010):
 * devuelve `{}`. NUNCA lanza: cualquier fallo del adaptador (red, parseo,
 * SSRF rechazado, timeout) se captura aquí y degrada a "no encontrado".
 */
export async function scrapearSitio(sitio: SitioScraping, isbn: string): Promise<ResultadoScraping> {
  const adaptador = ADAPTADORES_POR_DOMINIO[sitio.dominio];
  if (!adaptador) {
    console.warn(`scrapearSitio: dominio sin adaptador de código: ${sitio.dominio}`);
    return RESULTADO_VACIO;
  }

  try {
    return await adaptador(isbn);
  } catch (error) {
    console.error(`scrapearSitio: fallo inesperado para dominio=${sitio.dominio}`, error);
    return RESULTADO_VACIO;
  }
}
