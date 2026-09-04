import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MetadatosService, PortadaCandidata } from '../../core/api/metadatos.service';
import { SinPortadaFallbackDirective } from '../directivas/sin-portada-fallback.directive';

/**
 * Diálogo compartido de selección manual de portada — para cuando la
 * portada cargada al catalogar/editar un libro es un placeholder genérico
 * sin palabra clave detectable por `portadaEsInvalida` (ej. URLs con un ID
 * individual, sin texto tipo "no-disponible"/"sin-imagen"). Reutilizado por
 * `CatalogarLibroComponent` y `EditarLibroComponent`.
 *
 * El padre es dueño del signal de visibilidad (`visible`, `input.required`)
 * — mismo criterio que el diálogo de "Vender" en `libro-detalle.component.ts`,
 * solo que aquí expuesto como input/output en vez de un signal interno,
 * porque este componente se reutiliza en 2 lugares distintos. Al volverse
 * visible, dispara `MetadatosService.buscarPortadas(isbn())` de inmediato —
 * el llamador ya garantiza que solo se abre con un ISBN presente (deshabilita
 * el botón que lo abre en caso contrario).
 *
 * Flujo de selección en 2 pasos, según lo pedido: el usuario elige una
 * tarjeta (queda resaltada) y confirma con "Cambiar" — un clic en una
 * tarjeta NO cierra el diálogo por sí solo, evita elegir por error al tocar
 * la imagen equivocada en una pantalla pequeña.
 */
@Component({
  selector: 'app-selector-portada',
  imports: [SinPortadaFallbackDirective],
  templateUrl: './selector-portada.component.html',
})
export class SelectorPortadaComponent {
  private readonly metadatosService = inject(MetadatosService);

  readonly isbn = input.required<string>();
  readonly visible = input.required<boolean>();

  readonly cerrar = output<void>();
  readonly portadaSeleccionada = output<string>();

  protected readonly candidatos = signal<PortadaCandidata[]>([]);
  protected readonly cargando = signal(false);
  protected readonly seleccionada = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.visible()) {
        void this.buscar();
      } else {
        this.seleccionada.set(null);
      }
    });
  }

  private async buscar(): Promise<void> {
    this.cargando.set(true);
    this.candidatos.set([]);
    this.seleccionada.set(null);
    const resultado = await this.metadatosService.buscarPortadas(this.isbn());
    this.candidatos.set(resultado);
    this.cargando.set(false);
  }

  protected seleccionar(candidato: PortadaCandidata): void {
    this.seleccionada.set(candidato.portadaUrl);
  }

  protected confirmar(): void {
    const url = this.seleccionada();
    if (url) {
      this.portadaSeleccionada.emit(url);
    }
  }

  protected cancelar(): void {
    this.cerrar.emit();
  }
}
