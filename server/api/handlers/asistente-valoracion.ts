import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { crearAlmacenControl, hashDeVisitante, leerSalDelDia } from '../lib/control-asistente';
import type { RegistroAsistente } from '../lib/registro-asistente';
import { establecerAtributoSiExiste, obtenerPorClave } from '../services/dynamodb';

/**
 * `POST /api/asistente/valoracion` — pulgar arriba o abajo a una respuesta de Melquíades (Fase 7, T-0070).
 *
 * Cuerpo: `{ registroId, valoracion: 'positiva' | 'negativa' }`. El `registroId` lo devuelve `POST /api/asistente`.
 * Es un UUID opaco, pero no basta como prueba de que la persona pidió esa respuesta: se comprueba que quien valora
 * sea el MISMO visitante, rehaciendo el hash de su IP con la sal del día del registro y comparándolo con el
 * guardado. Sin IP ni sesión, es lo único que ata la valoración a quien preguntó. La sal dura 3 días: pasado ese
 * plazo ya no se puede verificar y se rechaza (la valoración debe darse cuando se recibe la respuesta).
 *
 * Solo escribe el campo `valoracion` de un registro que ya existe (puede cambiarse de opinión: gana la última).
 */

export interface DependenciasValoracion {
  leerRegistro(registroId: string): Promise<RegistroAsistente | null>;
  leerSal(dia: string): Promise<string | null>;
  guardarValoracion(registroId: string, valoracion: 'positiva' | 'negativa'): Promise<boolean>;
}

export type ResultadoValoracion =
  | { estado: 200 }
  | { estado: 400 | 403 | 404; error: string };

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALORACIONES = ['positiva', 'negativa'] as const;

export async function valorar(
  dependencias: DependenciasValoracion,
  cuerpo: unknown,
  ip: string,
): Promise<ResultadoValoracion> {
  const datos = cuerpo !== null && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : null;
  const registroId = datos?.['registroId'];
  const valoracion = datos?.['valoracion'];
  if (typeof registroId !== 'string' || !FORMATO_UUID.test(registroId)) {
    return { estado: 400, error: 'El identificador de la respuesta no es válido.' };
  }
  if (typeof valoracion !== 'string' || !(VALORACIONES as readonly string[]).includes(valoracion)) {
    return { estado: 400, error: 'La valoración debe ser positiva o negativa.' };
  }

  const registro = await dependencias.leerRegistro(registroId);
  if (!registro) {
    return { estado: 404, error: 'No encontré esa respuesta.' };
  }
  const sal = await dependencias.leerSal(registro.dia);
  // Mismo mensaje y mismo código si la sal caducó o el hash no coincide: no se le dice a un tercero cuál de las dos fue.
  if (sal === null || hashDeVisitante(ip, sal) !== registro.visitante) {
    return { estado: 403, error: 'No puedes valorar esa respuesta.' };
  }
  const guardada = await dependencias.guardarValoracion(registroId, valoracion as 'positiva' | 'negativa');
  return guardada ? { estado: 200 } : { estado: 404, error: 'No encontré esa respuesta.' };
}

function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}.`);
  }
  return valor;
}

function respuestaJson(statusCode: number, cuerpo: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) };
}

const MAXIMO_CARACTERES_CUERPO = 500;

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyResultV2> => {
  try {
    if (process.env['ASISTENTE_ACTIVO'] !== 'true') {
      return respuestaJson(503, { error: 'El asistente no está disponible por ahora.' });
    }
    const crudo = event.body ?? '';
    if (crudo.length > MAXIMO_CARACTERES_CUERPO) {
      return respuestaJson(413, { error: 'La petición es demasiado grande.' });
    }
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(event.isBase64Encoded ? Buffer.from(crudo, 'base64').toString('utf8') : crudo);
    } catch {
      return respuestaJson(400, { error: 'El cuerpo no es JSON válido.' });
    }
    const almacen = crearAlmacenControl(variable('TABLA_CONTROL'));
    const resultado = await valorar(
      {
        leerRegistro: async (registroId) =>
          (await obtenerPorClave<RegistroAsistente>(variable('TABLA_REGISTROS'), { registroId })) ?? null,
        leerSal: (dia) => leerSalDelDia(almacen, dia),
        guardarValoracion: (registroId, valoracion) =>
          establecerAtributoSiExiste(variable('TABLA_REGISTROS'), { registroId }, 'valoracion', valoracion),
      },
      cuerpo,
      event.requestContext?.http?.sourceIp ?? 'desconocida',
    );
    return resultado.estado === 200 ? respuestaJson(200, { ok: true }) : respuestaJson(resultado.estado, { error: resultado.error });
  } catch (error) {
    console.error('asistente-valoracion: error inesperado', error instanceof Error ? error.name : 'desconocido');
    return respuestaJson(500, { error: 'Error interno del servidor.' });
  }
};
