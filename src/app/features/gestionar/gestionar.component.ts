import { Component, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { CatalogarLibroComponent } from './catalogar-libro.component';
import { EditarLibroComponent } from './editar-libro.component';

type Pestaña = 'catalogar' | 'editar';

/** Ambas pestañas comparten la ruta `/catalogar` (sin sub-ruta propia), así que el `title:` de la ruta solo cubre la pestaña inicial — el cambio de pestaña debe actualizar el `<title>` a mano. */
const TITULOS_PESTANA: Record<Pestaña, string> = {
  catalogar: 'Catalogar - Le Tiende',
  editar: 'Editar - Le Tiende',
};

/**
 * Ruta protegida `/catalogar` (`RoleGuard(['vendedor','administrador'])`,
 * `TODO.md`, área "Gestionar") — reemplaza a `/catalogar` y `/libros`. Dos
 * pestañas independientes (`pestanaActiva`, mismo patrón de tabs que
 * `GestionUbicacionFisicaComponent`): "Catalogar" (`CatalogarLibroComponent`,
 * movido aquí desde `features/catalogar/`) y "Editar" (`EditarLibroComponent`,
 * nuevo — reemplaza a `ListaLibrosCatalogadosComponent`/`CambiarUbicacionComponent`).
 *
 * Este componente solo resuelve el cambio de pestaña — toda la lógica de
 * cada una vive en su propio componente hijo, cada uno con su propio estado
 * (formularios, servicios, cascada de ubicación) sin compartir nada entre sí.
 */
@Component({
  selector: 'app-gestionar',
  imports: [CatalogarLibroComponent, EditarLibroComponent],
  templateUrl: './gestionar.component.html',
})
export class GestionarComponent {
  private readonly title = inject(Title);

  protected readonly pestanaActiva = signal<Pestaña>('catalogar');

  protected cambiarPestana(pestaña: Pestaña): void {
    this.pestanaActiva.set(pestaña);
    this.title.setTitle(TITULOS_PESTANA[pestaña]);
  }
}
