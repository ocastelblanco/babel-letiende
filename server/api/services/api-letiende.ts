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
}

interface RespuestaApiLetiende {
  items?: Array<{ volumeInfo?: VolumeInfoGoogleBooks }>;
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
