import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { IScannerControls } from '@zxing/browser';
import { AuthService } from '../../core/auth/auth.service';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import type { Libro } from '../../core/models/libro.model';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';
import { SelectorPortadaComponent } from '../../shared/selector-portada/selector-portada.component';

const PVP_MAXIMO = 5_000_000;

/** Quita tildes y normaliza mayúsculas — mismo criterio que `catalogo-publico.component.ts`/`catalogar-libro.component.ts`. */
function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Pestaña "Editar" del área "Gestionar" (`/catalogar`, `TODO.md`) — lista
 * TODOS los libros catalogados, incluidos los agotados
 * (`LibrosService.cargarInventario`, `GET /api/libros/inventario`): a
 * diferencia del catálogo público (`GET /api/libros`), esta es la pantalla
 * de inventario, donde también hace falta poder editar/eliminar un libro sin
 * ejemplares disponibles.
 *
 * Filtro por título/autor/ISBN resuelto en el cliente (mismo criterio que
 * `CatalogoPublicoComponent`) — reutiliza el mismo lector de código de
 * barras (`@zxing/browser`, EAN-13) ya construido en `CatalogarLibroComponent`
 * para completar el campo ISBN del filtro por escaneo.
 *
 * Formulario de edición (`ajustes-2026-07-27.md` Tarea 1): TODOS los campos
 * del libro son editables — no solo ubicación/cantidad/PVP/descuento — y se
 * organiza en dos paneles separados, igual que `CatalogarLibroComponent`:
 * primero **Ubicación del libro** (cascada Espacio → Mueble → Ubicación) y,
 * debajo, **Información del libro** (ISBN con su propio lector de código de
 * barras, título, autor, editorial, portada, cantidad, PVP, descuento
 * editorial). "ELIMINAR LIBRO" (`DELETE /api/libros/:bookId`) es visible
 * solo para `administrador` — misma salvaguarda visual (ADR-009) que
 * `GestionUsuariosComponent`: la autorización real siempre la revalida el
 * backend (`CLAUDE.md` A01), este componente nunca decide por sí mismo.
 */
@Component({
  selector: 'app-editar-libro',
  imports: [ReactiveFormsModule, PvpPipe, SelectorPortadaComponent],
  templateUrl: './editar-libro.component.html',
})
export class EditarLibroComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly usuariosService = inject(UsuariosService);
  private readonly librosService = inject(LibrosService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);

  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly muebles = this.ubicacionFisicaService.muebles;
  protected readonly ubicaciones = this.ubicacionFisicaService.ubicaciones;

  protected readonly inventario = this.librosService.inventario;
  protected readonly cargandoInventario = this.librosService.cargandoInventario;
  protected readonly errorInventario = this.librosService.errorInventario;

  /** `true` si el usuario autenticado es administrador — guard visual de "ELIMINAR LIBRO" (ADR-009), se apoya en `authService.usuario()` para desaparecer de inmediato al cerrar sesión. */
  protected readonly esAdministrador = computed(
    () => this.authService.usuario() !== null && this.usuariosService.usuarioActual()?.rol === 'administrador',
  );

  protected readonly filtro = signal('');
  /**
   * Filtro por título/autor/ISBN sobre el inventario ya cargado.
   *
   * Los campos se leen SIEMPRE con `?? ''` y nunca comparando contra `null`:
   * un libro catalogado sin ISBN se persiste con el atributo AUSENTE en
   * DynamoDB (`omitirCamposNulos`, GSI `isbn-index` tipado `S`), así que en
   * el JSON de `GET /api/libros/inventario` ese `isbn` llega `undefined`, no
   * `null`. El guard anterior (`libro.isbn !== null`) lo dejaba pasar y
   * `undefined.includes(...)` reventaba dentro del `computed`, tumbando el
   * render de TODA la lista apenas se escribía algo en el buscador
   * (encontrado en producción 2026-08-29). El backend ya normaliza `isbn` a
   * `null` en la respuesta (`normalizarLibro`), pero este componente ya no
   * vuelve a depender de eso.
   */
  protected readonly librosFiltrados = computed(() => {
    const normalizado = normalizarTexto(this.filtro());
    const isbnBuscado = this.filtro().trim();
    if (normalizado === '') {
      return this.inventario();
    }
    return this.inventario().filter(
      (libro) =>
        normalizarTexto(libro.titulo ?? '').includes(normalizado) ||
        normalizarTexto(libro.autor ?? '').includes(normalizado) ||
        (libro.isbn ?? '').includes(isbnBuscado),
    );
  });

  /** Referencia al `<video>` del escáner del filtro (lista de libros). */
  private readonly videoEscaner = viewChild<ElementRef<HTMLVideoElement>>('videoEscaner');
  protected readonly escaneando = signal(false);
  protected readonly errorEscaneo = signal<string | null>(null);
  private controlesEscaner: IScannerControls | null = null;

  /** Referencia al `<video>` del escáner del formulario de edición (campo ISBN) — instancia independiente de la del filtro, ambos `@if` son mutuamente excluyentes pero cada uno maneja su propio estado. */
  private readonly videoEscanerEdicion = viewChild<ElementRef<HTMLVideoElement>>('videoEscanerEdicion');
  protected readonly escaneandoEdicion = signal(false);
  protected readonly errorEscaneoEdicion = signal<string | null>(null);
  private controlesEscanerEdicion: IScannerControls | null = null;

  /** `null` en modo lista; el `bookId` de la fila en edición. */
  protected readonly libroEditandoId = signal<string | null>(null);
  protected readonly editEspacioId = signal('');
  protected readonly editMuebleId = signal('');
  protected readonly editUbicacionId = signal('');

  /** Muebles del espacio elegido en el formulario de edición (cascada Espacio → Mueble). */
  protected readonly editMueblesDelEspacio = computed(() =>
    this.muebles().filter((mueble) => mueble.espacioId === this.editEspacioId()),
  );
  /** Ubicaciones del mueble elegido en el formulario de edición (cascada Mueble → Ubicación). */
  protected readonly editUbicacionesDelMueble = computed(() =>
    this.ubicaciones().filter((ubicacion) => ubicacion.muebleId === this.editMuebleId()),
  );

  protected readonly formularioEdicion = this.fb.nonNullable.group({
    isbn: [''],
    titulo: ['', [Validators.required]],
    autor: ['', [Validators.required]],
    editorial: [''],
    portadaUrl: [''],
    cantidadTotal: [0, [Validators.required, Validators.min(0)]],
    pvp: [0, [Validators.required, Validators.min(1), Validators.max(PVP_MAXIMO)]],
    porcentajeDescuentoEditorial: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

  protected readonly guardando = signal(false);
  protected readonly eliminandoBookId = signal<string | null>(null);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** Visibilidad del diálogo de selección manual de portada (`SelectorPortadaComponent`) — para placeholders genéricos sin palabra clave detectable. */
  protected readonly selectorPortadaVisible = signal(false);

  /** Reemplaza `portadaUrl` con la elegida en `SelectorPortadaComponent` y cierra el diálogo. */
  protected alSeleccionarPortada(url: string): void {
    this.formularioEdicion.controls.portadaUrl.setValue(url);
    this.selectorPortadaVisible.set(false);
  }

  ngOnInit(): void {
    void this.librosService.cargarInventario();
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();
  }

  ngOnDestroy(): void {
    this.detenerEscaneo();
    this.detenerEscaneoEdicion();
  }

  /** Activa la cámara y busca un EAN-13 para completar el filtro — mismo patrón que `CatalogarLibroComponent.iniciarEscaneo`. */
  protected async iniciarEscaneo(): Promise<void> {
    this.errorEscaneo.set(null);

    const video = this.videoEscaner()?.nativeElement;
    if (!video) {
      this.errorEscaneo.set('No se pudo iniciar la cámara. Ingresa el ISBN manualmente.');
      return;
    }

    this.escaneando.set(true);

    const hints = new Map<DecodeHintType, BarcodeFormat[]>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
    const lector = new BrowserMultiFormatReader(hints);

    try {
      this.controlesEscaner = await lector.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (resultado) => {
          if (resultado) {
            this.filtro.set(resultado.getText());
            this.detenerEscaneo();
          }
        },
      );
    } catch {
      this.escaneando.set(false);
      this.errorEscaneo.set('No se pudo acceder a la cámara. Verifica los permisos o ingresa el ISBN manualmente.');
    }
  }

  protected detenerEscaneo(): void {
    this.controlesEscaner?.stop();
    this.controlesEscaner = null;
    this.escaneando.set(false);
  }

  /** Igual que `iniciarEscaneo`, pero completa el campo ISBN del formulario de edición en vez del filtro. */
  protected async iniciarEscaneoEdicion(): Promise<void> {
    this.errorEscaneoEdicion.set(null);

    const video = this.videoEscanerEdicion()?.nativeElement;
    if (!video) {
      this.errorEscaneoEdicion.set('No se pudo iniciar la cámara. Ingresa el ISBN manualmente.');
      return;
    }

    this.escaneandoEdicion.set(true);

    const hints = new Map<DecodeHintType, BarcodeFormat[]>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
    const lector = new BrowserMultiFormatReader(hints);

    try {
      this.controlesEscanerEdicion = await lector.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (resultado) => {
          if (resultado) {
            this.formularioEdicion.controls.isbn.setValue(resultado.getText());
            this.detenerEscaneoEdicion();
          }
        },
      );
    } catch {
      this.escaneandoEdicion.set(false);
      this.errorEscaneoEdicion.set(
        'No se pudo acceder a la cámara. Verifica los permisos o ingresa el ISBN manualmente.',
      );
    }
  }

  protected detenerEscaneoEdicion(): void {
    this.controlesEscanerEdicion?.stop();
    this.controlesEscanerEdicion = null;
    this.escaneandoEdicion.set(false);
  }

  /** Ruta jerárquica completa "Espacio → Mueble → Ubicación" de un libro, para describir su ubicación física en cada fila de la lista (a diferencia del selector de edición, aquí no hace falta la cascada, solo mostrar la cadena ya resuelta). `'Sin ubicación'` si algún eslabón ya no existe. */
  protected rutaUbicacion(ubicacionId: string): string {
    const ubicacion = this.ubicaciones().find((ubicacion) => ubicacion.ubicacionId === ubicacionId);
    const mueble = ubicacion && this.muebles().find((mueble) => mueble.muebleId === ubicacion.muebleId);
    const espacio = mueble && this.espacios().find((espacio) => espacio.espacioId === mueble.espacioId);

    if (!ubicacion || !mueble || !espacio) {
      return 'Sin ubicación';
    }
    return `${espacio.nombre} → ${mueble.nombre} → ${ubicacion.nombre}`;
  }

  /** Abre el formulario de edición precargado con TODOS los datos actuales del libro, incluida la cascada Espacio/Mueble resuelta desde su `ubicacionId`. */
  protected editar(libro: Libro): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.libroEditandoId.set(libro.bookId);

    const ubicacionActual = this.ubicaciones().find((ubicacion) => ubicacion.ubicacionId === libro.ubicacionId);
    const muebleActual = ubicacionActual
      ? this.muebles().find((mueble) => mueble.muebleId === ubicacionActual.muebleId)
      : undefined;
    this.editEspacioId.set(muebleActual?.espacioId ?? '');
    this.editMuebleId.set(ubicacionActual?.muebleId ?? '');
    this.editUbicacionId.set(libro.ubicacionId ?? '');

    this.formularioEdicion.setValue({
      isbn: libro.isbn ?? '',
      titulo: libro.titulo,
      autor: libro.autor,
      editorial: libro.editorial ?? '',
      portadaUrl: libro.portadaUrl ?? '',
      cantidadTotal: libro.cantidadTotal,
      pvp: libro.pvp,
      porcentajeDescuentoEditorial: libro.porcentajeDescuentoEditorial,
    });
  }

  protected cancelarEdicion(): void {
    this.detenerEscaneoEdicion();
    this.libroEditandoId.set(null);
    this.editEspacioId.set('');
    this.editMuebleId.set('');
    this.editUbicacionId.set('');
    this.formularioEdicion.reset({
      isbn: '',
      titulo: '',
      autor: '',
      editorial: '',
      portadaUrl: '',
      cantidadTotal: 0,
      pvp: 0,
      porcentajeDescuentoEditorial: 0,
    });
  }

  /** Cambiar el Espacio recalcula las opciones de Mueble y limpia la selección previa (cascada) — mismo patrón que `GestionUbicacionFisicaComponent`. */
  protected alCambiarEditEspacio(): void {
    this.editMuebleId.set('');
    this.editUbicacionId.set('');
  }

  /** Cambiar el Mueble recalcula las opciones de Ubicación y limpia la selección previa (cascada). */
  protected alCambiarEditMueble(): void {
    this.editUbicacionId.set('');
  }

  protected async guardarEdicion(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      return;
    }
    const bookId = this.libroEditandoId();
    const ubicacionId = this.editUbicacionId();
    if (!bookId) {
      return;
    }
    if (!ubicacionId) {
      this.mensajeError.set('Selecciona Espacio, Mueble y Ubicación antes de guardar.');
      return;
    }

    this.guardando.set(true);
    try {
      const valores = this.formularioEdicion.getRawValue();
      const resultado = await this.librosService.editarLibro(bookId, {
        isbn: valores.isbn.trim() === '' ? null : valores.isbn.trim(),
        titulo: valores.titulo,
        autor: valores.autor,
        editorial: valores.editorial.trim() === '' ? null : valores.editorial.trim(),
        portadaUrl: valores.portadaUrl.trim() === '' ? null : valores.portadaUrl.trim(),
        ubicacionId,
        cantidadTotal: valores.cantidadTotal,
        pvp: valores.pvp,
        porcentajeDescuentoEditorial: valores.porcentajeDescuentoEditorial,
      });

      if (resultado.exito) {
        this.mensajeExito.set('Libro actualizado correctamente.');
        this.cancelarEdicion();
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  /** Elimina el libro tras confirmar — visible solo para `administrador` (guard visual, plantilla), el backend vuelve a exigirlo (CLAUDE.md A01). */
  protected async eliminar(libro: Libro): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar el libro "${libro.titulo}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    this.eliminandoBookId.set(libro.bookId);
    try {
      const resultado = await this.librosService.eliminarLibro(libro.bookId);
      if (resultado.exito) {
        this.mensajeExito.set('Libro eliminado correctamente.');
        if (this.libroEditandoId() === libro.bookId) {
          this.cancelarEdicion();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoBookId.set(null);
    }
  }
}
