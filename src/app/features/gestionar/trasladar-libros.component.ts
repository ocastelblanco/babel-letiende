import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LibrosService, type ResultadoTraslado } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import type { Libro } from '../../core/models/libro.model';
import { ScrollInfinitoDirective } from '../../shared/directivas/scroll-infinito.directive';
import { SinPortadaFallbackDirective } from '../../shared/directivas/sin-portada-fallback.directive';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';

/** Cantidad de libros renderizados al inicio y agregados en cada tanda (mismo criterio que `EditarLibroComponent`). */
const TAMANO_TANDA_RENDERIZADO = 60;

/** Un fusionado con el título del libro trasladado resuelto, para mostrarlo en el resultado. */
interface FusionadoConTitulo {
  titulo: string;
  pvpDestino: number;
  pvpTrasladado: number;
}

/** Resumen del último traslado, con los títulos ya resueltos (el inventario se recarga tras el traslado, así que se resuelven antes). */
interface ResumenTraslado {
  trasladados: number;
  fusionados: FusionadoConTitulo[];
  sinCambios: number;
  fallidos: { titulo: string; motivo: string }[];
}

/**
 * Pestaña "Trasladar" del área "Gestionar" (`/catalogar`,
 * `docs/plan-trasladar-libros.md` §5): traslado masivo de los libros de un
 * Mueble (una, varias o todas sus Ubicaciones) a otra Ubicación.
 *
 * Los libros de origen se filtran en memoria sobre el inventario ya cargado
 * (`LibrosService.inventario`, sin endpoint nuevo para leer). La selección se
 * modela al revés — `excluidos` guarda los libros DESELECCIONADOS — para que
 * todo libro visible esté seleccionado por defecto sin importar cuándo llegue
 * el inventario ni si se activa "Mostrar agotados" después.
 *
 * La autorización real (rol, destino válido, fusión de duplicados por ISBN)
 * ocurre en el backend (`POST /api/libros/trasladar`, CLAUDE.md A01).
 */
@Component({
  selector: 'app-trasladar-libros',
  imports: [PvpPipe, SinPortadaFallbackDirective, ScrollInfinitoDirective],
  templateUrl: './trasladar-libros.component.html',
})
export class TrasladarLibrosComponent implements OnInit {
  private readonly librosService = inject(LibrosService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);

  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly muebles = this.ubicacionFisicaService.muebles;
  protected readonly ubicaciones = this.ubicacionFisicaService.ubicaciones;

  protected readonly inventario = this.librosService.inventario;
  protected readonly cargandoInventario = this.librosService.cargandoInventario;
  protected readonly errorInventario = this.librosService.errorInventario;

  // --- Origen ---
  protected readonly origenEspacioId = signal('');
  protected readonly origenMuebleId = signal('');
  /** Ubicaciones del mueble de origen marcadas (todas por defecto al elegir el mueble). */
  protected readonly origenUbicacionIds = signal<ReadonlySet<string>>(new Set());
  protected readonly mostrarAgotados = signal(false);
  /** `bookId` de los libros DESELECCIONADOS por el usuario. */
  protected readonly excluidos = signal<ReadonlySet<string>>(new Set());

  protected readonly origenMuebles = computed(() =>
    this.muebles().filter((mueble) => mueble.espacioId === this.origenEspacioId()),
  );
  protected readonly origenUbicaciones = computed(() =>
    this.ubicaciones().filter((ubicacion) => ubicacion.muebleId === this.origenMuebleId()),
  );
  protected readonly todasLasUbicacionesMarcadas = computed(
    () =>
      this.origenUbicaciones().length > 0 &&
      this.origenUbicaciones().every((ubicacion) => this.origenUbicacionIds().has(ubicacion.ubicacionId)),
  );

  /** Libros de las ubicaciones marcadas, ordenados por título (agotados solo con "Mostrar agotados"). */
  protected readonly librosOrigen = computed(() => {
    const marcadas = this.origenUbicacionIds();
    const conAgotados = this.mostrarAgotados();
    return this.inventario()
      .filter((libro) => marcadas.has(libro.ubicacionId) && (conAgotados || libro.cantidadDisponible > 0))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  });
  protected readonly librosSeleccionados = computed(() =>
    this.librosOrigen().filter((libro) => !this.excluidos().has(libro.bookId)),
  );

  protected readonly limiteRenderizado = signal(TAMANO_TANDA_RENDERIZADO);
  protected readonly librosVisibles = computed(() => this.librosOrigen().slice(0, this.limiteRenderizado()));

  // --- Destino (diálogo) ---
  protected readonly dialogoVisible = signal(false);
  protected readonly destinoEspacioId = signal('');
  protected readonly destinoMuebleId = signal('');
  protected readonly destinoUbicacionId = signal('');
  protected readonly destinoMuebles = computed(() =>
    this.muebles().filter((mueble) => mueble.espacioId === this.destinoEspacioId()),
  );
  protected readonly destinoUbicaciones = computed(() =>
    this.ubicaciones().filter((ubicacion) => ubicacion.muebleId === this.destinoMuebleId()),
  );
  /** "Espacio › Mueble › Ubicación" del destino elegido, para el resumen del diálogo. */
  protected readonly destinoRuta = computed(() => this.rutaUbicacion(this.destinoUbicacionId()));

  protected readonly trasladando = signal(false);
  protected readonly errorTraslado = signal<string | null>(null);
  protected readonly resumen = signal<ResumenTraslado | null>(null);

  ngOnInit(): void {
    void this.librosService.cargarInventario();
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();
  }

  /** "Espacio › Mueble › Ubicación" de una ubicación, o `'—'` si algún eslabón ya no existe. */
  protected rutaUbicacion(ubicacionId: string): string {
    const ubicacion = this.ubicaciones().find((candidata) => candidata.ubicacionId === ubicacionId);
    const mueble = ubicacion && this.muebles().find((candidato) => candidato.muebleId === ubicacion.muebleId);
    const espacio = mueble && this.espacios().find((candidato) => candidato.espacioId === mueble.espacioId);
    if (!ubicacion || !mueble || !espacio) {
      return '—';
    }
    return `${espacio.nombre} › ${mueble.nombre} › ${ubicacion.nombre}`;
  }

  /** Nombre de la ubicación (solo el último eslabón) — suficiente para distinguir filas dentro de un mismo mueble. */
  protected nombreUbicacion(ubicacionId: string): string {
    return this.ubicaciones().find((ubicacion) => ubicacion.ubicacionId === ubicacionId)?.nombre ?? '—';
  }

  // --- Cambios del origen: cada uno reinicia la selección (todo visible vuelve a quedar seleccionado) ---

  protected alCambiarOrigenEspacio(valor: string): void {
    this.origenEspacioId.set(valor);
    this.origenMuebleId.set('');
    this.origenUbicacionIds.set(new Set());
    this.reiniciarSeleccion();
  }

  protected alCambiarOrigenMueble(valor: string): void {
    this.origenMuebleId.set(valor);
    this.origenUbicacionIds.set(new Set(this.origenUbicaciones().map((ubicacion) => ubicacion.ubicacionId)));
    this.reiniciarSeleccion();
  }

  protected alAlternarOrigenUbicacion(ubicacionId: string): void {
    const marcadas = new Set(this.origenUbicacionIds());
    if (marcadas.has(ubicacionId)) {
      marcadas.delete(ubicacionId);
    } else {
      marcadas.add(ubicacionId);
    }
    this.origenUbicacionIds.set(marcadas);
    this.reiniciarSeleccion();
  }

  protected alAlternarTodasLasUbicaciones(): void {
    this.origenUbicacionIds.set(
      this.todasLasUbicacionesMarcadas()
        ? new Set()
        : new Set(this.origenUbicaciones().map((ubicacion) => ubicacion.ubicacionId)),
    );
    this.reiniciarSeleccion();
  }

  protected alAlternarAgotados(): void {
    this.mostrarAgotados.update((valor) => !valor);
  }

  private reiniciarSeleccion(): void {
    this.excluidos.set(new Set());
    this.limiteRenderizado.set(TAMANO_TANDA_RENDERIZADO);
    this.resumen.set(null);
  }

  // --- Selección de libros ---

  protected estaSeleccionado(bookId: string): boolean {
    return !this.excluidos().has(bookId);
  }

  protected alAlternarLibro(bookId: string): void {
    const excluidos = new Set(this.excluidos());
    if (excluidos.has(bookId)) {
      excluidos.delete(bookId);
    } else {
      excluidos.add(bookId);
    }
    this.excluidos.set(excluidos);
  }

  protected seleccionarTodos(): void {
    this.excluidos.set(new Set());
  }

  protected seleccionarNinguno(): void {
    this.excluidos.set(new Set(this.librosOrigen().map((libro) => libro.bookId)));
  }

  /** Aumenta `limiteRenderizado` en una tanda, sin pasarse del total — invocado por el centinela `appScrollInfinito`. */
  protected cargarMasLibros(): void {
    this.limiteRenderizado.update((limite) =>
      Math.min(limite + TAMANO_TANDA_RENDERIZADO, this.librosOrigen().length),
    );
  }

  // --- Diálogo de destino ---

  protected abrirDialogo(): void {
    if (this.librosSeleccionados().length === 0) {
      return;
    }
    this.destinoEspacioId.set('');
    this.destinoMuebleId.set('');
    this.destinoUbicacionId.set('');
    this.errorTraslado.set(null);
    this.dialogoVisible.set(true);
  }

  protected cerrarDialogo(): void {
    if (this.trasladando()) {
      return;
    }
    this.dialogoVisible.set(false);
  }

  protected alCambiarDestinoEspacio(valor: string): void {
    this.destinoEspacioId.set(valor);
    this.destinoMuebleId.set('');
    this.destinoUbicacionId.set('');
  }

  protected alCambiarDestinoMueble(valor: string): void {
    this.destinoMuebleId.set(valor);
    this.destinoUbicacionId.set('');
  }

  protected async confirmarTraslado(): Promise<void> {
    const destino = this.destinoUbicacionId();
    const libros = this.librosSeleccionados();
    if (!destino || libros.length === 0 || this.trasladando()) {
      return;
    }

    this.trasladando.set(true);
    this.errorTraslado.set(null);

    const resultado = await this.librosService.trasladarLibros(
      libros.map((libro) => libro.bookId),
      destino,
    );

    this.trasladando.set(false);
    if (!resultado.exito) {
      this.errorTraslado.set(resultado.error);
      return;
    }

    this.resumen.set(this.armarResumen(resultado.resultado, libros));
    this.excluidos.set(new Set());
    this.dialogoVisible.set(false);
  }

  /** Resuelve los títulos con la lista de libros enviada (el inventario ya se recargó y los libros pudieron cambiar de ubicación). */
  private armarResumen(resultado: ResultadoTraslado, enviados: Libro[]): ResumenTraslado {
    const tituloPorId = new Map(enviados.map((libro) => [libro.bookId, libro.titulo]));
    const titulo = (bookId: string): string => tituloPorId.get(bookId) ?? bookId;
    return {
      trasladados: resultado.trasladados.length,
      fusionados: resultado.fusionados.map((fusion) => ({
        titulo: titulo(fusion.bookId),
        pvpDestino: fusion.pvpDestino,
        pvpTrasladado: fusion.pvpTrasladado,
      })),
      sinCambios: resultado.sinCambios.length,
      fallidos: resultado.fallidos.map((fallo) => ({ titulo: titulo(fallo.bookId), motivo: fallo.motivo })),
    };
  }

  /** Fusionados cuyo PVP difiere entre el registro del destino y el trasladado — el vendedor debe revisarlos en "Editar". */
  protected pvpDistintos(fusionados: FusionadoConTitulo[]): FusionadoConTitulo[] {
    return fusionados.filter((fusion) => fusion.pvpDestino !== fusion.pvpTrasladado);
  }
}
