import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogarLibroComponent } from './catalogar-libro.component';
import { EditarLibroComponent } from './editar-libro.component';

type Pestaña = 'catalogar' | 'editar';

/**
 * Ruta protegida `/gestionar` (`RoleGuard(['vendedor','administrador'])`,
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
  imports: [RouterLink, CatalogarLibroComponent, EditarLibroComponent],
  templateUrl: './gestionar.component.html',
})
export class GestionarComponent {
  protected readonly pestanaActiva = signal<Pestaña>('catalogar');

  protected cambiarPestana(pestaña: Pestaña): void {
    this.pestanaActiva.set(pestaña);
  }
}
