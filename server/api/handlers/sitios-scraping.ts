import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { TokenInvalidoError, verificarTokenDesdeHeader } from '../lib/verificar-token';
import { eliminar, escanearTodo, guardar, obtenerPorClave } from '../services/dynamodb';

/** Copia local de `src/app/core/models/sitio-scraping.model.ts` — mismo motivo que en otros handlers. */
interface SitioScraping {
  dominio: string;
  nombre: string;
  url: string;
  info: boolean;
  pvp: boolean;
  prioridad: number;
}

/** Copia local de `src/app/core/models/usuario.model.ts` — mismo motivo que en otros handlers. */
interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}

function respuestaJson(statusCode: number, cuerpo?: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  };
}

function nombreTablaSitiosScraping(): string {
  const nombre = process.env['TABLA_SITIOS_SCRAPING'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_SITIOS_SCRAPING.');
  }
  return nombre;
}

function nombreTablaUsuarios(): string {
  const nombre = process.env['TABLA_USUARIOS'];
  if (!nombre) {
    throw new Error('Falta la variable de entorno TABLA_USUARIOS.');
  }
  return nombre;
}

/**
 * Verifica el ID Token y exige rol `administrador` exclusivamente (CLAUDE.md
 * A01) — mismo patrón que `estantes.ts`/`editoriales-descuentos.ts`.
 */
async function exigirAdministrador(headerAuthorization: string | undefined): Promise<string | null> {
  const { email } = await verificarTokenDesdeHeader(headerAuthorization);
  const usuario = await obtenerPorClave<Usuario>(nombreTablaUsuarios(), { email });
  return usuario?.rol === 'administrador' ? email : null;
}

/**
 * Valida que `valor` sea un hostname razonable: string no vacía, sin
 * espacios, sin protocolo (`://`) y con al menos un punto — regex simple,
 * suficiente para este CRUD (no hace falta una librería de parseo de URLs).
 * No hace ninguna resolución DNS ni petición saliente (eso es la guardia
 * SSRF fija de la Tarea 2, ADR-011; este handler NUNCA hace fetch).
 */
function dominioValido(valor: unknown): valor is string {
  if (typeof valor !== 'string') {
    return false;
  }
  const dominio = valor.trim();
  if (dominio === '' || /\s/.test(dominio) || dominio.includes('://') || !dominio.includes('.')) {
    return false;
  }
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(dominio);
}

function urlValida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith('https://') && valor.trim() !== 'https://';
}

function prioridadValida(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

/** Datos aceptados en el body de `PUT /api/sitios-scraping/{dominio}` — sin `dominio` (clave primaria, va en el path). */
interface DatosSitioScraping {
  nombre: string;
  url: string;
  info: boolean;
  pvp: boolean;
  prioridad: number;
}

type ResultadoValidacion =
  | { valido: true; datos: DatosSitioScraping }
  | { valido: false; error: string };

/**
 * Valida el body de `PUT /api/sitios-scraping/{dominio}`. Exportada para
 * poder probarla sin invocar el handler completo (mismo patrón que
 * `validarDatosDescuentoEditorial`).
 */
export function validarDatosSitioScraping(cuerpo: unknown): ResultadoValidacion {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (typeof datos['nombre'] !== 'string' || datos['nombre'].trim() === '') {
    return { valido: false, error: 'El nombre es requerido.' };
  }
  if (!urlValida(datos['url'])) {
    return { valido: false, error: 'La url debe empezar con https://.' };
  }
  if (typeof datos['info'] !== 'boolean') {
    return { valido: false, error: 'El campo info debe ser un booleano.' };
  }
  if (typeof datos['pvp'] !== 'boolean') {
    return { valido: false, error: 'El campo pvp debe ser un booleano.' };
  }
  if (!prioridadValida(datos['prioridad'])) {
    return { valido: false, error: 'La prioridad debe ser un número.' };
  }

  return {
    valido: true,
    datos: {
      nombre: datos['nombre'],
      url: datos['url'] as string,
      info: datos['info'],
      pvp: datos['pvp'],
      prioridad: datos['prioridad'] as number,
    },
  };
}

/** Datos aceptados en el body de `POST /api/sitios-scraping` — incluye `dominio`, la clave primaria, que no se genera. */
type ResultadoValidacionNueva =
  | { valido: true; datos: DatosSitioScraping & { dominio: string } }
  | { valido: false; error: string };

/**
 * Valida el body de `POST /api/sitios-scraping`. Exportada para poder
 * probarla sin invocar el handler completo.
 */
export function validarDatosNuevoSitioScraping(cuerpo: unknown): ResultadoValidacionNueva {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { valido: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }
  const datos = cuerpo as Record<string, unknown>;

  if (!dominioValido(datos['dominio'])) {
    return { valido: false, error: 'El dominio es requerido y debe ser un hostname válido (ej. www.ejemplo.com).' };
  }

  const resto = validarDatosSitioScraping(cuerpo);
  if (!resto.valido) {
    return resto;
  }

  return { valido: true, datos: { dominio: datos['dominio'].trim(), ...resto.datos } };
}

/**
 * CRUD `/api/sitios-scraping` (`plan-obtencion-info-libros.md` §6 Task A,
 * ADR-010): las 4 operaciones exigen rol `administrador` exclusivamente. Un
 * solo Lambda para los 4 verbos (ADR-008, mismo patrón que
 * `estantes.ts`/`editoriales-descuentos.ts`), distinguidos por
 * `event.requestContext.http.method`. `dominio` es la clave primaria de
 * `babel-sitios-scraping`, no se genera.
 *
 * Alcance de esta tarea: SOLO datos + administración (CRUD). Este handler
 * NUNCA hace ninguna petición HTTP saliente a los sitios — el motor de
 * scraping (con la guardia SSRF fija, ADR-011) es la Tarea 2, completamente
 * separada.
 *
 * `POST` sobre un `dominio` que ya existe responde `409` en vez de
 * sobrescribir en silencio — misma decisión ya tomada para `POST
 * /api/editoriales-descuentos` (ADR-009).
 */
export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    const email = await exigirAdministrador(event.headers['authorization']);
    if (!email) {
      return respuestaJson(403, {
        error: 'Este correo no está autorizado para administrar sitios de scraping en Babel.',
      });
    }

    const metodo = event.requestContext.http.method;
    const dominioObjetivo = event.pathParameters?.['dominio'];

    if (metodo === 'GET') {
      const sitios = await escanearTodo<SitioScraping>(nombreTablaSitiosScraping());
      return respuestaJson(200, sitios);
    }

    if (metodo === 'POST') {
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosNuevoSitioScraping(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const existente = await obtenerPorClave<SitioScraping>(nombreTablaSitiosScraping(), {
        dominio: validacion.datos.dominio,
      });
      if (existente) {
        return respuestaJson(409, { error: 'Ya existe un sitio de scraping registrado con ese dominio.' });
      }
      const sitio: SitioScraping = { ...validacion.datos };
      await guardar(nombreTablaSitiosScraping(), sitio);
      return respuestaJson(201, sitio);
    }

    if (metodo === 'PUT') {
      if (!dominioObjetivo) {
        return respuestaJson(400, { error: 'Falta el dominio en la ruta.' });
      }
      const existente = await obtenerPorClave<SitioScraping>(nombreTablaSitiosScraping(), {
        dominio: dominioObjetivo,
      });
      if (!existente) {
        return respuestaJson(404, { error: 'No existe un sitio de scraping con ese dominio.' });
      }
      let cuerpo: unknown;
      try {
        cuerpo = event.body ? JSON.parse(event.body) : undefined;
      } catch {
        return respuestaJson(400, { error: 'El cuerpo de la petición no es JSON válido.' });
      }
      const validacion = validarDatosSitioScraping(cuerpo);
      if (!validacion.valido) {
        return respuestaJson(400, { error: validacion.error });
      }
      const sitio: SitioScraping = { dominio: dominioObjetivo, ...validacion.datos };
      await guardar(nombreTablaSitiosScraping(), sitio);
      return respuestaJson(200, sitio);
    }

    if (metodo === 'DELETE') {
      if (!dominioObjetivo) {
        return respuestaJson(400, { error: 'Falta el dominio en la ruta.' });
      }
      const existente = await obtenerPorClave<SitioScraping>(nombreTablaSitiosScraping(), {
        dominio: dominioObjetivo,
      });
      if (!existente) {
        return respuestaJson(404, { error: 'No existe un sitio de scraping con ese dominio.' });
      }
      await eliminar(nombreTablaSitiosScraping(), { dominio: dominioObjetivo });
      return respuestaJson(204);
    }

    return respuestaJson(405, { error: 'Método no soportado.' });
  } catch (error) {
    if (error instanceof TokenInvalidoError) {
      return respuestaJson(401, { error: error.message });
    }
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
