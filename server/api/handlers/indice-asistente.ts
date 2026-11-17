import type { Handler } from 'aws-lambda';
import { crearProveedorLlm } from '../lib/gemini';
import { crearAlmacenS3, type AlmacenIndice } from '../lib/almacen-indice';
import {
  deserializarIndice,
  documentoParaIndice,
  cuantizar,
  planificarReconstruccion,
  serializarIndice,
  type ConocimientoParaIndice,
  type EntradaIndice,
  type IndiceVectorial,
} from '../lib/indice-vectorial';
import { ErrorProveedorLlm, type ProveedorLlm } from '../lib/proveedor-llm';
import { escanearProyeccion, escanearTodo } from '../services/dynamodb';

/**
 * Reconstrucción incremental del índice de embeddings del asistente
 * (`asistente-ia/PLAN.md` Fase 2, T-0022). Corre programada (EventBridge) y se
 * puede invocar a mano. Solo pide vectores de los libros nuevos o cuyo texto
 * cambió; el resto se conserva. Es reanudable: si se agota el tiempo o la cuota
 * del proveedor, guarda lo que logró y la siguiente corrida sigue.
 *
 * Privacidad: el archivo del índice guarda vectores y datos para filtrar, nunca
 * texto de sinopsis. El resumen que devuelve y registra solo lleva cifras.
 */

/** Libros por llamada al proveedor (coincide con el tamaño de lote del cliente). */
const TAMANO_LOTE = 50;
/** Deja margen bajo el tope de 15 minutos de Lambda para escribir el archivo. */
const PRESUPUESTO_MS = 12 * 60 * 1000;
const PAUSA_ENTRE_LOTES_MS = 300;

interface LibroMinimo {
  bookId: string;
  titulo: string;
  autor: string;
}

interface ConocimientoFila extends ConocimientoParaIndice {
  bookId: string;
}

export interface ResumenReconstruccion {
  /** Libros en el catálogo. */
  totalLibros: number;
  /** Libros con vector en el índice resultante. */
  indexados: number;
  nuevos: number;
  actualizados: number;
  conservados: number;
  eliminados: number;
  /** Indexados sin sinopsis (solo título y autor). */
  sinSinopsis: number;
  /** Sin vector todavía: se agotó el tiempo, la cuota, o falló el proveedor. */
  pendientes: number;
  escrito: boolean;
  /** Otra reconstrucción escribió primero; esta no pisó nada. */
  conflicto: boolean;
  motivoParada: 'completa' | 'tiempo' | 'proveedor';
  tokensEntrada: number;
  modelo: string;
  duracionMs: number;
}

export interface DependenciasReconstruccion {
  proveedor: ProveedorLlm;
  almacen: AlmacenIndice;
  leerLibros: () => Promise<LibroMinimo[]>;
  leerConocimiento: () => Promise<ConocimientoFila[]>;
  dimensiones: number;
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const esperarReal = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

export async function reconstruirIndice(
  dependencias: DependenciasReconstruccion,
): Promise<ResumenReconstruccion> {
  const ahora = dependencias.ahora ?? Date.now;
  const esperar = dependencias.esperar ?? esperarReal;
  const inicio = ahora();
  const { proveedor, almacen, dimensiones } = dependencias;

  const [libros, conocimientos, guardado] = await Promise.all([
    dependencias.leerLibros(),
    dependencias.leerConocimiento(),
    almacen.leer(),
  ]);

  let existente: IndiceVectorial | null = null;
  if (guardado) {
    try {
      existente = deserializarIndice(guardado.contenido);
    } catch (error) {
      // Un archivo ilegible no debe impedir reconstruir: se parte de cero y se sobrescribe.
      console.error(
        'reconstruirIndice: el índice existente es ilegible; se reconstruye desde cero.',
        error,
      );
    }
  }

  const conocimientoPorLibro = new Map(conocimientos.map((fila) => [fila.bookId, fila]));
  const documentos = libros
    .filter((libro) => libro.bookId)
    .map((libro) => documentoParaIndice(libro, conocimientoPorLibro.get(libro.bookId) ?? null));

  const plan = planificarReconstruccion(
    existente,
    documentos,
    proveedor.modeloEmbeddings,
    dimensiones,
  );

  const nuevos: { entrada: EntradaIndice; vector: Int8Array }[] = [];
  let tokensEntrada = 0;
  let motivoParada: ResumenReconstruccion['motivoParada'] = 'completa';
  for (let desde = 0; desde < plan.porIncrustar.length; desde += TAMANO_LOTE) {
    if (ahora() - inicio > PRESUPUESTO_MS) {
      motivoParada = 'tiempo';
      break;
    }
    const lote = plan.porIncrustar.slice(desde, desde + TAMANO_LOTE);
    try {
      const resultado = await proveedor.incrustarDocumentos(
        lote.map((documento) => ({ titulo: documento.titulo, texto: documento.texto })),
      );
      tokensEntrada += resultado.tokensEntrada;
      lote.forEach((documento, posicion) => {
        nuevos.push({
          entrada: {
            bookId: documento.bookId,
            hash: documento.hash,
            sinSinopsis: documento.sinSinopsis,
            idioma: documento.idioma,
            clasificacionEdad: documento.clasificacionEdad,
          },
          vector: cuantizar(resultado.vectores[posicion]),
        });
      });
    } catch (error) {
      if (!(error instanceof ErrorProveedorLlm)) {
        throw error;
      }
      // Cuota agotada o proveedor caído: se guarda lo logrado y la próxima corrida continúa.
      console.error(
        `reconstruirIndice: el proveedor falló (${error.message}); se guarda el avance.`,
      );
      motivoParada = 'proveedor';
      break;
    }
    await esperar(PAUSA_ENTRE_LOTES_MS);
  }

  // Un libro cambiado cuyo vector nuevo no se pudo pedir conserva el anterior (con su huella vieja, para que la próxima corrida lo reintente).
  const idsNuevos = new Set(nuevos.map((fila) => fila.entrada.bookId));
  const retenidos = [...plan.desactualizados.entries()]
    .filter(([bookId]) => !idsNuevos.has(bookId))
    .map(([, previo]) => previo);
  const resultado = [...plan.conservados, ...retenidos, ...nuevos].sort((a, b) =>
    a.entrada.bookId.localeCompare(b.entrada.bookId),
  );
  const cambio =
    nuevos.length > 0 ||
    plan.eliminados > 0 ||
    existente === null ||
    existente.modelo !== proveedor.modeloEmbeddings ||
    JSON.stringify(existente.entradas) !== JSON.stringify(resultado.map((fila) => fila.entrada));

  let escrito = false;
  let conflicto = false;
  if (cambio) {
    const indice: IndiceVectorial = {
      modelo: proveedor.modeloEmbeddings,
      dimensiones,
      creadoEn: new Date(ahora()).toISOString(),
      entradas: resultado.map((fila) => fila.entrada),
      vectores: resultado.map((fila) => fila.vector),
    };
    const veredicto = await almacen.escribir(serializarIndice(indice), guardado?.version ?? null);
    escrito = veredicto === 'ok';
    conflicto = veredicto === 'conflicto';
  }

  return {
    totalLibros: documentos.length,
    indexados: resultado.length,
    nuevos: nuevos.filter((fila) => !plan.desactualizados.has(fila.entrada.bookId)).length,
    actualizados: nuevos.filter((fila) => plan.desactualizados.has(fila.entrada.bookId)).length,
    conservados: plan.conservados.length,
    eliminados: plan.eliminados,
    sinSinopsis: resultado.filter((fila) => fila.entrada.sinSinopsis).length,
    // Sin vector alguno, o con uno viejo a la espera de reemplazo.
    pendientes: plan.porIncrustar.length - nuevos.length,
    escrito,
    conflicto,
    motivoParada,
    tokensEntrada,
    modelo: proveedor.modeloEmbeddings,
    duracionMs: ahora() - inicio,
  };
}

function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}.`);
  }
  return valor;
}

export const handler: Handler<unknown, ResumenReconstruccion> = async () => {
  const resumen = await reconstruirIndice({
    proveedor: crearProveedorLlm(),
    almacen: crearAlmacenS3(variable('BUCKET_INDICE')),
    leerLibros: () =>
      escanearProyeccion<LibroMinimo>(variable('TABLA_LIBROS'), ['bookId', 'titulo', 'autor']),
    leerConocimiento: () => escanearTodo<ConocimientoFila>(variable('TABLA_CONOCIMIENTO')),
    dimensiones: 768,
  });
  console.log('reconstruirIndice: resumen', JSON.stringify(resumen));
  return resumen;
};
