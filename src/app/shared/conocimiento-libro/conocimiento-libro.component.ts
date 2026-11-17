import { Component, computed, input, output, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { etiquetaFuenteSinopsis, MAXIMO_CARACTERES_SINOPSIS, type GrupoConocimiento } from './conocimiento-libro.formulario';

/**
 * Campos del conocimiento de un libro para el asistente de recomendación
 * (sinopsis, categorías, idioma, páginas, clasificación por edad), en un
 * bloque plegable y opcional. Compartido por `CatalogarLibroComponent` y
 * `EditarLibroComponent` (ADR-018, `asistente-ia/PLAN.md` Fase 1).
 *
 * Es solo la vista: el padre es dueño del `FormGroup` (`crearGrupoConocimiento`)
 * y de la fuente de la sinopsis. Lo que llega de una fuente externa aparece
 * como sugerencia editable (CLAUDE.md A08) con su procedencia; si la persona
 * edita la sinopsis, el padre la pasa a `manual` mediante `sinopsisEditada`.
 * El texto se muestra con interpolación estándar de Angular, nunca como HTML
 * (CLAUDE.md A03). Está plegado por defecto para no estorbar la ruta crítica
 * de catalogación, y se abre solo si algún campo tiene un error.
 */
@Component({
  selector: 'app-conocimiento-libro',
  imports: [ReactiveFormsModule],
  templateUrl: './conocimiento-libro.component.html',
})
export class ConocimientoLibroComponent {
  readonly grupo = input.required<GrupoConocimiento>();
  /** `google-books`, `sitio:<dominio>`, `manual` o `null` (sin sinopsis). */
  readonly fuente = input<string | null>(null);
  /** Prefijo de los `id` del HTML, para que dos instancias nunca los repitan. */
  readonly idPrefijo = input('conocimiento');
  /** Se emite cuando la persona escribe en la sinopsis. */
  readonly sinopsisEditada = output<void>();

  protected readonly maximoSinopsis = MAXIMO_CARACTERES_SINOPSIS;
  protected readonly abiertoPorLaPersona = signal(false);
  protected readonly etiquetaFuente = computed(() => etiquetaFuenteSinopsis(this.fuente()));

  /** Un campo con error fuerza la apertura: el error no puede quedar escondido en un bloque plegado. */
  protected hayError(): boolean {
    const grupo = this.grupo();
    return grupo.invalid && grupo.touched;
  }

  protected alAlternar(evento: Event): void {
    this.abiertoPorLaPersona.set((evento.target as HTMLDetailsElement).open);
  }
}
