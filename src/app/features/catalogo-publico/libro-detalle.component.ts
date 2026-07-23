import { Component, OnInit, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LibrosService } from '../../core/api/libros.service';
import type { LibroConEstante } from '../../core/models/libro.model';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';

/**
 * Ficha pública de un libro puntual (`tech-specs.md`, módulo
 * `catalogo-publico/`; `TODO.md`, ficha de libro), ruta `/libro/:bookId`,
 * sin guard — pública igual que `CatalogoPublicoComponent`. `RenderMode`
 * la resuelve el catch-all `**` de `app.routes.server.ts` (`RenderMode.Server`,
 * mismo criterio ya aplicado a `''`: sin guard, se puede renderizar en el
 * servidor para SEO).
 *
 * Pide el libro directo a `GET /api/libros/:bookId` (no reutiliza el
 * `libros()` de `LibrosService` como hace `CambiarEstanteComponent`) porque
 * esta puede ser la primera petición de la sesión — un visitante puede
 * llegar por un enlace directo o un buscador sin haber visto antes el
 * listado en `/`.
 */
@Component({
  selector: 'app-libro-detalle',
  imports: [PvpPipe, RouterLink],
  templateUrl: './libro-detalle.component.html',
})
export class LibroDetalleComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly librosService = inject(LibrosService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  private readonly bookId = this.route.snapshot.paramMap.get('bookId') ?? '';

  protected readonly libro = signal<LibroConEstante | null>(null);
  protected readonly cargando = signal(true);
  /** `true` cuando el libro no existe o la petición falló — mismo mensaje para ambos casos ante el visitante (`LibrosService.obtenerDetalle` nunca lanza). */
  protected readonly noEncontrado = signal(false);

  ngOnInit(): void {
    void this.cargarLibro();
  }

  private async cargarLibro(): Promise<void> {
    this.cargando.set(true);
    const libro = await this.librosService.obtenerDetalle(this.bookId);
    this.cargando.set(false);

    if (!libro) {
      this.noEncontrado.set(true);
      return;
    }

    this.libro.set(libro);
    this.title.setTitle(`${libro.titulo} — Catálogo Le Tiende`);
    this.meta.updateTag({
      name: 'description',
      content: `${libro.titulo}, de ${libro.autor}. Disponible en el catálogo de Le Tiende.`,
    });
    this.meta.updateTag({ property: 'og:title', content: libro.titulo });
    if (libro.portadaUrl) {
      this.meta.updateTag({ property: 'og:image', content: libro.portadaUrl });
    }
  }
}
