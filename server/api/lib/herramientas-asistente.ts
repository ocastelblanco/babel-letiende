import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeclaracionHerramienta } from './proveedor-llm';

/**
 * Herramientas de solo lectura que el modelo puede pedir (`asistente-ia/PLAN.md` Fase 3, T-0030).
 * Este módulo declara las herramientas y valida lo que el modelo envía; ejecutarlas es cosa del
 * orquestador (necesita la base de datos y el índice). Todo lo que sale de aquí hacia el modelo es
 * una lista blanca: nunca `costo`, `utilidad`, descuentos ni datos de ventas.
 *
 * Los argumentos los escribe el modelo y no son de fiar: la prueba contra la API real mostró que
 * puede OMITIR un parámetro obligatorio (T-0030, verificación F). Por eso `validarLlamada` revisa
 * cada herramienta por su cuenta en vez de confiar en el esquema que se declaró.
 */

export const MAXIMO_RONDAS = 3;
/** Llamadas que se ejecutan por vuelta; las demás reciben un error controlado (todas necesitan respuesta). */
export const MAXIMO_LLAMADAS_POR_RONDA = 4;
export const MAXIMO_LIBROS_POR_CONSULTA_DE_DISPONIBILIDAD = 5;
const MAXIMO_CARACTERES_CONSULTA = 300;
const MAXIMO_CARACTERES_TEMA = 80;
const MAXIMO_CARACTERES_ID = 64;
const MAXIMO_PRECIO = 10_000_000;

export const NOMBRES_HERRAMIENTAS = ['buscar_libros', 'consultar_disponibilidad', 'consultar_politicas'] as const;
export type NombreHerramienta = (typeof NOMBRES_HERRAMIENTAS)[number];

export const HERRAMIENTAS: DeclaracionHerramienta[] = [
  {
    nombre: 'buscar_libros',
    descripcion:
      'Busca en el inventario libros disponibles hoy que se parezcan a una descripción, con filtros opcionales. Úsala cuando la persona cambie de tema, cuando pida algo que la lista que ya tienes no cubre, o cuando exija un idioma, un precio máximo o excluir contenido adulto que esa lista no respeta.',
    parametros: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué busca la persona, en sus propias palabras (tema, género, tono, público).' },
        idioma: { type: 'string', description: 'Código de idioma de dos o tres letras (es, en, pt, fr...). Solo si la persona lo pidió.' },
        precio_maximo: { type: 'number', description: 'Precio máximo en pesos colombianos. Solo si la persona lo pidió.' },
        excluir_contenido_adulto: { type: 'boolean', description: 'Verdadero si la persona pidió dejar fuera libros para adultos.' },
      },
      required: ['consulta'],
    },
  },
  {
    nombre: 'consultar_disponibilidad',
    descripcion:
      'Consulta el precio, las existencias y la ubicación física en la librería (espacio, mueble y ubicación) de libros concretos. Úsala cuando la persona pregunte cuántos quedan, cuánto cuesta o dónde encontrar un libro que ya salió en la conversación.',
    parametros: {
      type: 'object',
      properties: {
        book_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Los bookId exactos de la lista de libros (máximo 5).',
        },
      },
      required: ['book_ids'],
    },
  },
  {
    nombre: 'consultar_politicas',
    descripcion:
      'Consulta las políticas de la librería: horarios, formas de pago, cambios y devoluciones, envíos y similares. Úsala siempre que la persona pregunte por algo de ese estilo; nunca respondas esas preguntas de memoria.',
    parametros: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'El tema consultado, por ejemplo «horarios», «formas de pago» o «cambios».' },
      },
      required: ['tema'],
    },
  },
];

// ---------------------------------------------------------------------------
// Validación de los argumentos que escribe el modelo
// ---------------------------------------------------------------------------

export interface FiltrosBusqueda {
  idioma?: string;
  precioMaximo?: number;
  excluirContenidoAdulto?: boolean;
}

export type LlamadaValidada =
  | { ok: true; nombre: 'buscar_libros'; consulta: string; filtros: FiltrosBusqueda }
  | { ok: true; nombre: 'consultar_disponibilidad'; bookIds: string[] }
  | { ok: true; nombre: 'consultar_politicas'; tema: string }
  | { ok: false; error: string };

const ausente = (valor: unknown): boolean => valor === undefined || valor === null;

export function validarLlamada(nombre: string, argumentos: Record<string, unknown>): LlamadaValidada {
  switch (nombre) {
    case 'buscar_libros': {
      const consulta = typeof argumentos['consulta'] === 'string' ? argumentos['consulta'].trim() : '';
      if (consulta === '' || consulta.length > MAXIMO_CARACTERES_CONSULTA) {
        return { ok: false, error: `«consulta» es obligatoria: texto de 1 a ${MAXIMO_CARACTERES_CONSULTA} caracteres.` };
      }
      const filtros: FiltrosBusqueda = {};
      const idioma = argumentos['idioma'];
      if (!ausente(idioma)) {
        if (typeof idioma !== 'string' || !/^[a-z]{2,3}$/i.test(idioma)) {
          return { ok: false, error: '«idioma» debe ser un código de dos o tres letras.' };
        }
        filtros.idioma = idioma.toLowerCase();
      }
      const precio = argumentos['precio_maximo'];
      if (!ausente(precio)) {
        if (typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0 || precio > MAXIMO_PRECIO) {
          return { ok: false, error: '«precio_maximo» debe ser un número positivo en pesos.' };
        }
        filtros.precioMaximo = precio;
      }
      const adulto = argumentos['excluir_contenido_adulto'];
      if (!ausente(adulto)) {
        if (typeof adulto !== 'boolean') {
          return { ok: false, error: '«excluir_contenido_adulto» debe ser verdadero o falso.' };
        }
        filtros.excluirContenidoAdulto = adulto;
      }
      return { ok: true, nombre, consulta, filtros };
    }
    case 'consultar_disponibilidad': {
      const ids = argumentos['book_ids'];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAXIMO_LIBROS_POR_CONSULTA_DE_DISPONIBILIDAD) {
        return {
          ok: false,
          error: `«book_ids» es obligatoria: lista de 1 a ${MAXIMO_LIBROS_POR_CONSULTA_DE_DISPONIBILIDAD} bookId.`,
        };
      }
      if (!ids.every((id) => typeof id === 'string' && id.trim() !== '' && id.length <= MAXIMO_CARACTERES_ID)) {
        return { ok: false, error: 'Cada elemento de «book_ids» debe ser un bookId (texto).' };
      }
      return { ok: true, nombre, bookIds: [...new Set((ids as string[]).map((id) => id.trim()))] };
    }
    case 'consultar_politicas': {
      const tema = typeof argumentos['tema'] === 'string' ? argumentos['tema'].trim() : '';
      if (tema === '' || tema.length > MAXIMO_CARACTERES_TEMA) {
        return { ok: false, error: `«tema» es obligatorio: texto de 1 a ${MAXIMO_CARACTERES_TEMA} caracteres.` };
      }
      return { ok: true, nombre, tema };
    }
    default:
      return { ok: false, error: `La herramienta «${nombre.slice(0, 40)}» no existe.` };
  }
}

// ---------------------------------------------------------------------------
// Políticas de la librería (contenido del usuario: asistente-ia/conocimiento/politicas-libreria.md)
// ---------------------------------------------------------------------------

export interface TemaPolitica {
  titulo: string;
  contenido: string;
}

/**
 * Cada `## Título` del archivo es un tema. Los comentarios HTML (`<!-- ... -->`) son notas para quien
 * edita y no cuentan: un tema que solo tiene comentarios todavía no tiene contenido y no se ofrece.
 */
export function interpretarPoliticas(markdown: string): TemaPolitica[] {
  const sinComentarios = markdown.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const temas: TemaPolitica[] = [];
  const partes = sinComentarios.split(/^## +/m).slice(1);
  for (const parte of partes) {
    const salto = parte.indexOf('\n');
    const titulo = (salto === -1 ? parte : parte.slice(0, salto)).trim();
    const contenido = (salto === -1 ? '' : parte.slice(salto + 1)).trim();
    if (titulo !== '' && contenido !== '') {
      temas.push({ titulo, contenido });
    }
  }
  return temas;
}

export function cargarPoliticas(raiz: string = process.env['LAMBDA_TASK_ROOT'] ?? process.cwd()): TemaPolitica[] {
  try {
    return interpretarPoliticas(
      readFileSync(join(raiz, 'asistente-ia', 'conocimiento', 'politicas-libreria.md'), 'utf8'),
    );
  } catch {
    // Sin archivo, el asistente simplemente no tiene políticas que citar.
    return [];
  }
}

const normalizar = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const palabrasSignificativas = (texto: string): string[] =>
  normalizar(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((palabra) => palabra.length > 3);

export type ResultadoPolitica =
  | { encontrado: true; tema: string; contenido: string }
  | { encontrado: false; temasDisponibles: string[] };

export function buscarPolitica(temas: TemaPolitica[], consulta: string): ResultadoPolitica {
  const buscada = normalizar(consulta);
  const palabras = new Set(palabrasSignificativas(consulta));
  const encontrada =
    temas.find((t) => {
      const titulo = normalizar(t.titulo);
      return titulo.includes(buscada) || buscada.includes(titulo);
    }) ??
    temas.find((t) => palabrasSignificativas(t.titulo).some((palabra) => palabras.has(palabra)));
  return encontrada
    ? { encontrado: true, tema: encontrada.titulo, contenido: encontrada.contenido }
    : { encontrado: false, temasDisponibles: temas.map((t) => t.titulo) };
}
