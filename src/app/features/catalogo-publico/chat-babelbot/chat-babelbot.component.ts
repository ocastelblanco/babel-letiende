import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, OnInit, PLATFORM_ID, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AsistenteService,
  type MensajeHistorial,
  type MotivoFallo,
  type RecomendacionBabelbot,
} from '../../../core/api/asistente.service';
import { SinPortadaFallbackDirective } from '../../../shared/directivas/sin-portada-fallback.directive';
import { PvpPipe } from '../../../shared/pipes/pvp.pipe';

/** Mismo tope que el backend (`MAXIMO_CARACTERES_MENSAJE`). */
export const MAXIMO_CARACTERES_PREGUNTA = 1000;

/**
 * Aviso visible de que se habla con una IA y de qué se guarda (Ley 1581 de 2012; hallazgo LLM-04 de la revisión
 * OWASP). BORRADOR para revisión de quien responde por los datos de Le Tiende: describe lo que el backend hace hoy
 * (`registro-asistente.ts`: consulta enmascarada, sin IP ni respuesta, 90 días; Gemini de pago con `store: false`).
 */
export const AVISO_BABELBOT =
  'Hablas con BabelBot, una inteligencia artificial: puede equivocarse, así que confirma el precio y las existencias con la librería. ' +
  'Tu pregunta se procesa con Gemini, de Google, y la guardamos 90 días para mejorar el servicio, sin tu nombre ni tu IP y con correos, ' +
  'teléfonos y documentos ocultos. No escribas datos personales.';

export interface MensajeChat {
  id: number;
  rol: 'usuario' | 'asistente';
  texto: string;
  recomendaciones: RecomendacionBabelbot[];
  /** Solo en respuestas del asistente que quedaron registradas en el backend. */
  registroId: string | null;
  valoracion: 'positiva' | 'negativa' | null;
  errorValoracion: boolean;
}

/**
 * Chat de BabelBot en el catálogo público (Fase 7b, T-0070). Solo en el navegador (el SSR no lo pinta) y solo si el
 * servidor dice que está disponible para el público (`GET /api/asistente`): el build es el mismo en `staging` y en
 * producción. Las tarjetas se pintan con datos de Babel (lista blanca del backend); el texto del modelo va siempre
 * por interpolación, nunca como HTML.
 */
@Component({
  selector: 'app-chat-babelbot',
  imports: [PvpPipe, RouterLink, SinPortadaFallbackDirective],
  templateUrl: './chat-babelbot.component.html',
})
export class ChatBabelbotComponent implements OnInit {
  private readonly asistente = inject(AsistenteService);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private siguienteId = 1;

  protected readonly aviso = AVISO_BABELBOT;
  protected readonly maximoCaracteres = MAXIMO_CARACTERES_PREGUNTA;
  protected readonly disponible = signal(false);
  protected readonly abierto = signal(false);
  protected readonly mensajes = signal<MensajeChat[]>([]);
  protected readonly cargando = signal(false);
  protected readonly texto = signal('');
  protected readonly errorEnvio = signal<{ motivo: MotivoFallo; mensaje: string } | null>(null);

  private readonly entrada = viewChild<ElementRef<HTMLTextAreaElement>>('entrada');
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  async ngOnInit(): Promise<void> {
    if (this.esNavegador) {
      this.disponible.set(await this.asistente.estaDisponible());
    }
  }

  protected abrir(): void {
    this.abierto.set(true);
    setTimeout(() => this.entrada()?.nativeElement.focus());
  }

  protected cerrar(): void {
    this.abierto.set(false);
  }

  protected nuevaConversacion(): void {
    this.mensajes.set([]);
    this.errorEnvio.set(null);
    this.texto.set('');
    setTimeout(() => this.entrada()?.nativeElement.focus());
  }

  protected alEscribir(evento: Event): void {
    this.texto.set((evento.target as HTMLTextAreaElement).value);
  }

  /** Enter envía; Mayús+Enter agrega un salto de línea. */
  protected alPulsarEnter(evento: Event): void {
    if ((evento as KeyboardEvent).shiftKey) {
      return;
    }
    evento.preventDefault();
    void this.enviar();
  }

  protected async enviar(): Promise<void> {
    const pregunta = this.texto().trim();
    if (pregunta === '' || this.cargando()) {
      return;
    }
    const antes = this.mensajes();
    this.errorEnvio.set(null);
    this.texto.set('');
    this.mensajes.set([...antes, this.nuevo('usuario', pregunta)]);
    this.cargando.set(true);
    this.irAlFinal();

    const resultado = await this.asistente.preguntar(this.aHistorial(this.mensajes()));
    this.cargando.set(false);
    if (resultado.exito) {
      const { respuesta } = resultado;
      this.mensajes.update((actuales) => [
        ...actuales,
        { ...this.nuevo('asistente', respuesta.texto), recomendaciones: respuesta.recomendaciones, registroId: respuesta.registroId },
      ]);
    } else {
      // La pregunta sin respuesta sale del historial (este alterna persona/asistente) y vuelve a la caja para reenviarla.
      this.mensajes.set(antes);
      this.texto.set(pregunta);
      this.errorEnvio.set({ motivo: resultado.motivo, mensaje: resultado.mensaje });
    }
    this.irAlFinal();
  }

  protected async valorar(mensaje: MensajeChat, valoracion: 'positiva' | 'negativa'): Promise<void> {
    if (mensaje.registroId === null || mensaje.valoracion === valoracion) {
      return;
    }
    const guardada = await this.asistente.valorar(mensaje.registroId, valoracion);
    this.mensajes.update((actuales) =>
      actuales.map((m) => (m.id === mensaje.id ? { ...m, valoracion: guardada ? valoracion : m.valoracion, errorValoracion: !guardada } : m)),
    );
  }

  private nuevo(rol: 'usuario' | 'asistente', texto: string): MensajeChat {
    return { id: this.siguienteId++, rol, texto, recomendaciones: [], registroId: null, valoracion: null, errorValoracion: false };
  }

  private aHistorial(mensajes: MensajeChat[]): MensajeHistorial[] {
    return mensajes.map((m) =>
      m.rol === 'asistente' && m.recomendaciones.length > 0
        ? { rol: m.rol, texto: m.texto, libros: m.recomendaciones.map((r) => r.bookId) }
        : { rol: m.rol, texto: m.texto },
    );
  }

  private irAlFinal(): void {
    setTimeout(() => {
      const lista = this.lista()?.nativeElement;
      if (lista) {
        lista.scrollTop = lista.scrollHeight;
      }
    });
  }
}
