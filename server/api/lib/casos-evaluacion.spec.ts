import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIAS_DE_CASO, validarCaso, type CasoEvaluacion } from './evaluacion-asistente';

/** Guarda los archivos de `asistente-ia/evals/casos/`: un caso mal formado se descubre aquí y no a mitad de una corrida que gasta cuota. */
const CARPETA = join(process.cwd(), 'asistente-ia', 'evals', 'casos');
const archivos = readdirSync(CARPETA).filter((nombre) => nombre.endsWith('.json'));
const casos: CasoEvaluacion[] = archivos
  .filter((nombre) => nombre !== 'parches-congelado.json')
  .flatMap((nombre) => JSON.parse(readFileSync(join(CARPETA, nombre), 'utf8')) as CasoEvaluacion[]);
const parches = JSON.parse(readFileSync(join(CARPETA, 'parches-congelado.json'), 'utf8')) as { isbn: string; marcador: string; anexo: string }[];

describe('casos de evaluación', () => {
  it('todos tienen el formato que el ejecutor espera', () => {
    expect(casos.flatMap((caso) => validarCaso(caso))).toEqual([]);
  });

  it('los identificadores no se repiten', () => {
    const ids = casos.map((caso) => caso.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hay entre 40 y 60 casos y las siete categorías del plan están representadas', () => {
    expect(casos.length).toBeGreaterThanOrEqual(40);
    expect(casos.length).toBeLessThanOrEqual(60);
    for (const categoria of CATEGORIAS_DE_CASO) {
      expect(casos.some((caso) => caso.categoria === categoria), categoria).toBe(true);
    }
  });

  it('el identificador empieza con la letra de su categoría, para leer los resultados de un vistazo', () => {
    const prefijo: Record<string, string> = { aceptables: 'A', restricciones: 'R', 'sin-respuesta': 'S', ambiguo: 'M', 'inyeccion-directa': 'ID', 'inyeccion-indirecta': 'II', politicas: 'P' };
    for (const caso of casos) {
      expect(caso.id.startsWith(prefijo[caso.categoria]), caso.id).toBe(true);
    }
  });

  it('cada marcador de inyección indirecta tiene su parche, y cada parche trae su marcador en el anexo', () => {
    const marcadores = casos.filter((caso) => caso.categoria === 'inyeccion-indirecta').map((caso) => caso.marcadorInyeccion);
    expect(marcadores.sort()).toEqual(parches.map((parche) => parche.marcador).sort());
    for (const parche of parches) {
      expect(parche.anexo).toContain(parche.marcador);
    }
  });

  it('las preguntas que dependen del día traen una hora fija, para que la corrida sea repetible', () => {
    for (const caso of casos.filter((c) => c.categoria === 'politicas')) {
      expect(caso.ahora, caso.id).toBeDefined();
    }
  });
});
