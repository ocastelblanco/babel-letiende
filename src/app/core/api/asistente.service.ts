import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/** Un libro que Melquíades recomienda: solo datos que ya muestra la ficha pública (lista blanca del backend). */
export interface RecomendacionMelquiades {
  bookId: string;
  titulo: string;
  autor: string;
  pvp: number;
  portadaUrl: string | null;
  motivo: string;
}

/** Respuesta de `POST /api/asistente`. `registroId` es `null` si el backend no pudo guardar el registro (no se puede valorar). */
export interface RespuestaMelquiades {
  texto: string;
  recomendaciones: RecomendacionMelquiades[];
  sinResultados: boolean;
  registroId: string | null;
}

/** Un mensaje del historial tal como lo espera el backend (`libros`: los `bookId` que el asistente recomendó en ese mensaje). */
export interface MensajeHistorial {
  rol: 'usuario' | 'asistente';
  texto: string;
  libros?: string[];
}

/**
 * Por qué no hubo respuesta, para que la interfaz distinga lo que se arregla esperando de lo que no:
 * `saturado` (Gemini sin capacidad), `limite-visitante` (los 30 mensajes del día), `limite-tasa` (demasiadas
 * peticiones seguidas, lo corta API Gateway), `no-disponible` (apagado o sin índice) y `error` (cualquier otro).
 */
export type MotivoFallo = 'saturado' | 'limite-visitante' | 'limite-tasa' | 'no-disponible' | 'error';

export type ResultadoPregunta =
  | { exito: true; respuesta: RespuestaMelquiades }
  | { exito: false; motivo: MotivoFallo; mensaje: string };

/** Máximo de mensajes que acepta el backend en una petición (`MAXIMO_TURNOS`). */
export const MAXIMO_MENSAJES_POR_PETICION = 9;

const MENSAJE_RED = 'No pude conectarme. Revisa tu conexión e inténtalo de nuevo.';
const MENSAJE_LIMITE_TASA = 'Estás enviando mensajes muy rápido. Espera unos segundos y vuelve a intentarlo.';
const MENSAJE_GENERICO = 'No pude preparar una recomendación en este momento. Inténtalo de nuevo.';

/**
 * Cliente de Melquíades (Fase 7, T-0070): `GET /api/asistente` (¿está disponible?), `POST /api/asistente` (preguntar)
 * y `POST /api/asistente/valoracion`. Es el chat del catálogo público: no exige sesión, pero si hay una (personal de
 * Babel) la envía, porque con `ASISTENTE_ACCESO=personal` es lo que lo habilita. Nunca lanza.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** Sesión del personal si la hay; sin sesión (o si falla leerla) la petición va anónima. */
  private async opciones(): Promise<{ headers?: { Authorization: string } }> {
    try {
      const token = await this.auth.obtenerIdToken();
      return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    } catch {
      return {};
    }
  }

  /** `false` ante cualquier duda (error de red, 4xx, 5xx): un chat que no se puede verificar no se muestra. */
  async estaDisponible(): Promise<boolean> {
    try {
      const respuesta = await firstValueFrom(this.http.get<{ disponible?: unknown }>('/api/asistente', await this.opciones()));
      return respuesta?.disponible === true;
    } catch {
      return false;
    }
  }

  /** Solo viajan los últimos mensajes que caben en una petición, empezando siempre por uno de la persona. */
  recortarHistorial(historial: MensajeHistorial[]): MensajeHistorial[] {
    if (historial.length <= MAXIMO_MENSAJES_POR_PETICION) {
      return historial;
    }
    // La conversación alterna y termina con la persona: los últimos 9 (cantidad impar) empiezan con la persona.
    return historial.slice(historial.length - MAXIMO_MENSAJES_POR_PETICION);
  }

  async preguntar(historial: MensajeHistorial[]): Promise<ResultadoPregunta> {
    try {
      const respuesta = await firstValueFrom(
        this.http.post<RespuestaMelquiades>(
          '/api/asistente',
          { mensajes: this.recortarHistorial(historial), filtros: {} },
          await this.opciones(),
        ),
      );
      return { exito: true, respuesta };
    } catch (error) {
      return this.fallo(error);
    }
  }

  /** `true` si quedó guardada. */
  async valorar(registroId: string, valoracion: 'positiva' | 'negativa'): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post('/api/asistente/valoracion', { registroId, valoracion }));
      return true;
    } catch {
      return false;
    }
  }

  private fallo(error: unknown): ResultadoPregunta {
    if (!(error instanceof HttpErrorResponse) || error.status === 0) {
      return { exito: false, motivo: 'error', mensaje: MENSAJE_RED };
    }
    // Los mensajes los escribe el backend (citas literarias incluidas); solo se usa uno si es texto.
    const mensajeDelServidor = typeof error.error?.error === 'string' ? error.error.error : null;
    if (error.status === 429) {
      // El 429 del backend trae `error` (tope de mensajes del día); el de API Gateway trae `message` (demasiado rápido).
      return mensajeDelServidor
        ? { exito: false, motivo: 'limite-visitante', mensaje: mensajeDelServidor }
        : { exito: false, motivo: 'limite-tasa', mensaje: MENSAJE_LIMITE_TASA };
    }
    if (error.status === 503) {
      const motivo: MotivoFallo = error.error?.motivo === 'saturado' ? 'saturado' : 'no-disponible';
      return { exito: false, motivo, mensaje: mensajeDelServidor ?? MENSAJE_GENERICO };
    }
    return { exito: false, motivo: 'error', mensaje: mensajeDelServidor ?? MENSAJE_GENERICO };
  }
}
