#!/usr/bin/env node
/**
 * Prueba el prompt vigente del asistente contra el modelo REAL, con el mismo contexto que arma la
 * Lambda (fecha, políticas reales del archivo y lista de libros), para los casos que fallaron en
 * `staging` el 18/11/2026: un horario inventado y un horario del día equivocado. Requiere
 * `npm run build:api`. Usa la versión de `VERSION_PROMPT_ASISTENTE` (por defecto, la de serverless.yml).
 *
 * No sustituye la suite de evaluación de la Fase 4: es una alarma barata y con la clave de `staging`.
 * El modelo no es determinista, así que cada pregunta se repite y TODAS las repeticiones deben pasar.
 * Solo imprime la respuesta del modelo cuando una comprobación falla (son preguntas sintéticas y
 * políticas públicas: nada de datos de personas).
 */
import { readFileSync } from 'node:fs';
import { ProveedorGemini } from '../../dist-server/api/lib/gemini.js';
import { ESQUEMA_SALIDA, cargarPrompt, mensajesParaModelo } from '../../dist-server/api/lib/asistente.js';
import { HERRAMIENTAS, cargarPoliticas, politicasParaModelo } from '../../dist-server/api/lib/herramientas-asistente.js';

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const version = process.env.VERSION_PROMPT_ASISTENTE ?? /VERSION_PROMPT_ASISTENTE:\s*(v\d+)/.exec(readFileSync('serverless.yml', 'utf8'))?.[1] ?? 'v1';
const prompt = cargarPrompt(version);
const politicas = politicasParaModelo(cargarPoliticas());
const proveedor = new ProveedorGemini({ claveApi: process.env.GEMINI_API_KEY ?? '' });
const REPETICIONES = 3;
const PAUSA_ENTRE_LLAMADAS_MS = 5_000; // la clave gratuita permite 15 peticiones por minuto

let fallos = 0;
const comprobar = (condicion, descripcion, detalle) => {
  console.log(`${condicion ? 'OK   ' : 'FALLA'} ${descripcion}`);
  if (!condicion) {
    fallos += 1;
    if (detalle) console.log(`       respuesta: ${detalle}`);
  }
};

async function preguntar(texto, ahoraMs) {
  const peticion = {
    instrucciones: prompt.instrucciones,
    mensajes: mensajesParaModelo([{ rol: 'usuario', texto }], [], ahoraMs, politicas),
    esquemaSalida: ESQUEMA_SALIDA,
    maximoTokensSalida: 2048,
    nivelPensamiento: 'low',
    ...(prompt.herramientas ? { herramientas: HERRAMIENTAS } : {}),
  };
  for (let intento = 0; ; intento += 1) {
    await esperar(PAUSA_ENTRE_LLAMADAS_MS);
    try {
      return await proveedor.generarJson(peticion);
    } catch (error) {
      if (intento >= 2) throw error;
      console.log(`   (falló la llamada, se espera y se reintenta: ${error.name})`);
      await esperar(30_000);
    }
  }
}

async function repetir(texto, ahoraMs, descripcion, esValida) {
  for (let i = 1; i <= REPETICIONES; i += 1) {
    const g = await preguntar(texto, ahoraMs);
    let objeto = null;
    try { objeto = JSON.parse(g.texto); } catch { /* se reporta como falla */ }
    const respuesta = objeto?.texto ?? '';
    const ok = objeto !== null && g.llamadas.length === 0 && esValida(respuesta.toLowerCase());
    comprobar(ok, `${descripcion} (${i}/${REPETICIONES})`, ok ? undefined : (respuesta || `[sin texto; llamadas: ${g.llamadas.map((l) => l.nombre).join(',') || 'ninguna'}]`));
  }
}

console.log(`Prompt ${version} (${prompt.herramientas ? 'con' : 'sin'} herramientas), ${politicas.length} temas de políticas.\n`);

// Miércoles 18/11/2026, 12:00 m. en Bogotá = 17:00 UTC → mañana es jueves.
const MIERCOLES = Date.UTC(2026, 10, 18, 17, 0);
// Horario real del archivo: dom-mié 2-8 p. m.; jue-sáb 2-10 p. m. (lo comprueba la primera línea).
const horarios = politicas.find((t) => /horario/i.test(t.tema))?.texto ?? '';
comprobar(/jueves a s[aá]bado.*10:00\s*pm/i.test(horarios) && /domingo a mi[eé]rcoles.*8:00\s*pm/i.test(horarios), 'el archivo de políticas conserva el horario que esta prueba espera (jueves a sábado hasta las 10 p. m.; domingo a miércoles hasta las 8 p. m.)');

await repetir('¿Abren mañana? ¿en qué horario?', MIERCOLES, 'mañana (jueves) dice 10 p. m. y no inventa otro horario', (t) => /(10|diez)/.test(t) && !/nueve de la ma[ñn]ana|9:00\s*a\.?\s*m|9 a\.?\s*m/.test(t));
await repetir('¿Abren el domingo? ¿hasta qué hora?', MIERCOLES, 'domingo dice 8 p. m.', (t) => /(8|ocho)/.test(t) && !/(10|diez)\s*(p\.?\s*m|de la noche)/.test(t));
await repetir('¿Tienen parqueadero propio para los clientes?', MIERCOLES, 'un tema que no está en las políticas se reconoce sin inventar', (t) => /no (tengo|cuento|dispongo|dispone|tenemos)|no (esa|ese) (dato|informaci)|directamente|preguntar|comunicar/.test(t) && !/s[ií],? (tenemos|contamos|hay)/.test(t));

console.log(fallos === 0 ? '\nTodo en orden.' : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
