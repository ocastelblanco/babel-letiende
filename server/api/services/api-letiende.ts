/**
 * Cliente hacia la API externa `api.letiende.co` (compartida, tech-specs.md
 * §2). Contrato real verificado en vivo — distinto del documentado en
 * tech-specs.md línea 251, que describe NUESTRO endpoint propio
 * `GET /api/metadatos/:isbn`, no la API externa (ver TODO.md, Tarea de
 * autocompletado de metadatos):
 *
 *   `GET ${API_LETIENDE_BASE_URL}/libros?barcode=<isbn>` — pass-through casi
 *   directo de Google Books API v1 (`fields=items(volumeInfo)`).
 *   - Encontrado: `200` con `{ items: [{ volumeInfo: {...} }] }`.
 *   - No encontrado (limpio): `200` con `{}` (sin `items`).
 *   - Inestable: confirmado en vivo que responde `500`/`503` de forma
 *     intermitente incluso con ISBNs válidos (probable cuota/rate-limit de
 *     Google Books del lado de la API externa), y que reintentar segundos
 *     después puede responder `200` con datos correctos. Mitigación: esta
 *     función reintenta UNA vez (con una espera corta) cuando el intento
 *     falla por transporte/HTTP (error de red o no-200) antes de rendirse.
 *
 * Por eso esta función NUNCA lanza por un fallo de la API externa: cualquier
 * respuesta no-200, error de red o cuerpo inesperado se trata exactamente
 * igual que "no encontrado" (PRD.md §5.2, "Datos no encontrados → el
 * vendedor los completa manualmente" es un camino normal del flujo de
 * catalogación, no una falla que deba bloquear ni alarmar al vendedor).
 */

export interface MetadatosLibro {
  titulo: string | null;
  autor: string | null;
  editorial: string | null;
  portadaUrl: string | null;
}

const METADATOS_VACIOS: MetadatosLibro = {
  titulo: null,
  autor: null,
  editorial: null,
  portadaUrl: null,
};

interface VolumeInfoGoogleBooks {
  title?: string;
  authors?: string[];
  publisher?: string;
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
}

interface RespuestaApiLetiende {
  items?: Array<{ volumeInfo?: VolumeInfoGoogleBooks }>;
}

/**
 * Un candidato de la búsqueda por texto (`buscarLibrosPorTexto` y
 * `buscarEnVtexPorTexto` en `scraping.ts`) — a diferencia de
 * `MetadatosLibro`, que representa el resultado YA elegido/fusionado de un
 * ISBN puntual, un candidato es una de varias sugerencias que el vendedor
 * elige visualmente (TODO.md, Tarea de búsqueda por título/autor). `isbn` es
 * `null` cuando la fuente no lo expone — la mayoría de resultados de
 * búsqueda por texto de Google Books no traen `industryIdentifiers` con
 * `type: "ISBN_13"`.
 */
export interface CandidatoLibro {
  titulo: string;
  autor: string | null;
  editorial: string | null;
  portadaUrl: string | null;
  isbn: string | null;
}

/** Google Books sirve la portada en `http://` — el resto del sitio es HTTPS y es el mismo recurso en ambos esquemas. */
function aHttps(url: string): string {
  return url.replace(/^http:/, 'https:');
}

const DEMORA_REINTENTO_MS = 800;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type IntentoFetch = { ok: true; respuesta: Response } | { ok: false; status: number | 'error-red' };

/** Un solo intento de `fetch` contra la API externa. Nunca lanza: los fallos de transporte/HTTP se reportan como `{ ok: false }`. */
async function intentarFetchLibros(url: string): Promise<IntentoFetch> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url);
  } catch {
    return { ok: false, status: 'error-red' };
  }

  if (!respuesta.ok) {
    return { ok: false, status: respuesta.status };
  }

  return { ok: true, respuesta };
}

export async function obtenerMetadatosPorIsbn(isbn: string): Promise<MetadatosLibro> {
  const urlBase = process.env['API_LETIENDE_BASE_URL'];
  const url = `${urlBase}/libros?barcode=${encodeURIComponent(isbn)}`;

  let intento = await intentarFetchLibros(url);
  if (!intento.ok) {
    await esperar(DEMORA_REINTENTO_MS);
    intento = await intentarFetchLibros(url);
  }

  if (!intento.ok) {
    console.error(
      `obtenerMetadatosPorIsbn: ambos intentos fallaron para isbn=${isbn} (último resultado: ${intento.status})`,
    );
    return METADATOS_VACIOS;
  }

  const respuesta = intento.respuesta;

  let cuerpo: RespuestaApiLetiende;
  try {
    cuerpo = (await respuesta.json()) as RespuestaApiLetiende;
  } catch {
    return METADATOS_VACIOS;
  }

  const volumeInfo = cuerpo.items?.[0]?.volumeInfo;
  if (!volumeInfo) {
    return METADATOS_VACIOS;
  }

  return {
    titulo: volumeInfo.title ?? null,
    autor: volumeInfo.authors && volumeInfo.authors.length > 0 ? volumeInfo.authors.join(', ') : null,
    editorial: volumeInfo.publisher ?? null,
    portadaUrl: volumeInfo.imageLinks?.thumbnail ? aHttps(volumeInfo.imageLinks.thumbnail) : null,
  };
}

/**
 * Búsqueda por `titulo`/`autor` contra `api.letiende.co` (TODO.md, Tarea de
 * búsqueda por título/autor — para cuando el vendedor no tiene el ISBN a
 * mano) — mismo endpoint pass-through de Google Books que
 * `obtenerMetadatosPorIsbn`, pero con `titulo`/`autor` en vez de `barcode` y
 * devolviendo TODOS los candidatos (`items`), no solo el primero. Al menos
 * uno de los dos parámetros debe venir no vacío; si ninguno viene, devuelve
 * `[]` sin llamar a la red.
 *
 * Gotcha confirmado en vivo: sin resultados o sin parámetros reconocidos, la
 * API externa responde `200` con cuerpo `null` (no `{}` como en la búsqueda
 * por `barcode`) — se trata explícitamente como "sin candidatos", igual que
 * la ausencia de `items`.
 *
 * Reutiliza el mismo patrón de reintento único que `obtenerMetadatosPorIsbn`
 * (misma inestabilidad intermitente de la API externa) y NUNCA lanza:
 * cualquier fallo definitivo (tras el reintento), cuerpo no-JSON o `null`
 * degrada a `[]`.
 */
export async function buscarLibrosPorTexto(titulo: string | null, autor: string | null): Promise<CandidatoLibro[]> {
  const parametros = new URLSearchParams();
  if (titulo && titulo.trim() !== '') {
    parametros.set('titulo', titulo.trim());
  }
  if (autor && autor.trim() !== '') {
    parametros.set('autor', autor.trim());
  }
  if ([...parametros.keys()].length === 0) {
    return [];
  }

  const urlBase = process.env['API_LETIENDE_BASE_URL'];
  const url = `${urlBase}/libros?${parametros.toString()}`;

  let intento = await intentarFetchLibros(url);
  if (!intento.ok) {
    await esperar(DEMORA_REINTENTO_MS);
    intento = await intentarFetchLibros(url);
  }

  if (!intento.ok) {
    console.error(
      `buscarLibrosPorTexto: ambos intentos fallaron para titulo=${titulo ?? ''} autor=${autor ?? ''} (último resultado: ${intento.status})`,
    );
    return [];
  }

  let cuerpo: RespuestaApiLetiende | null;
  try {
    cuerpo = (await intento.respuesta.json()) as RespuestaApiLetiende | null;
  } catch {
    return [];
  }

  const items = cuerpo?.items;
  if (!items || items.length === 0) {
    return [];
  }

  const candidatos: CandidatoLibro[] = [];
  for (const item of items) {
    const volumeInfo = item.volumeInfo;
    if (!volumeInfo?.title) {
      continue;
    }
    candidatos.push({
      titulo: volumeInfo.title,
      autor: volumeInfo.authors && volumeInfo.authors.length > 0 ? volumeInfo.authors.join(', ') : null,
      editorial: volumeInfo.publisher ?? null,
      portadaUrl: volumeInfo.imageLinks?.thumbnail ? aHttps(volumeInfo.imageLinks.thumbnail) : null,
      isbn:
        volumeInfo.industryIdentifiers?.find((identificador) => identificador.type === 'ISBN_13')?.identifier
        ?? null,
    });
  }

  return candidatos;
}
