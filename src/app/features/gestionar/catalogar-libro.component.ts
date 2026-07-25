import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { IScannerControls } from '@zxing/browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EditorialesDescuentosService } from '../../core/api/editoriales-descuentos.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { MetadatosService, type CandidatoLibro } from '../../core/api/metadatos.service';

const PVP_MAXIMO = 5_000_000;

/** Quita tildes y normaliza mayúsculas para comparar nombres de editorial sin distinguir acentos/mayúsculas — mismo criterio que `catalogo-publico.component.ts`. */
function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Pestaña "Catalogar" del área "Gestionar" (`/gestionar`, `TODO.md`) —
 * captura los campos del libro contra `POST /api/libros`, ya verificado en
 * vivo. El ISBN puede llegar por escaneo con cámara (`@zxing/browser`) o
 * entrada manual; en ambos casos dispara la búsqueda de metadatos
 * (`MetadatosService`) que pre-carga título/autor/editorial/portada/pvp —
 * siempre editables por el vendedor. El PVP llega desde el fallback de
 * scraping que orquesta `GET /api/metadatos/:isbn`, nunca desde
 * `api.letiende.co`.
 *
 * La validación del formulario es solo UX: `POST /api/libros` vuelve a
 * validar y recalcula `costo`/`utilidadCatalogo`/`bookId`/`creadoPor` en el
 * backend — este componente nunca envía ni confía en esos valores
 * (`CLAUDE.md` A08).
 *
 * Panel "Ubicación del libro" (Espacio → Mueble → Ubicación, `ajustes-finales.md`
 * §"Catalogar"): a diferencia del resto del formulario, vive FUERA del
 * `FormGroup` reactivo (signals `panelEspacioId`/`panelMuebleId`/
 * `panelUbicacionId`, cascada igual que `GestionUbicacionFisicaComponent`) y
 * NO se limpia en `reiniciarFormulario()` — persiste entre catalogaciones
 * seguidas a propósito, porque el flujo real es catalogar todos los libros
 * de un mismo mueble/ubicación de forma consecutiva.
 *
 * Autocompletado de `porcentajeDescuentoEditorial`: al cambiar `editorial`
 * (por escaneo/búsqueda o escritura manual), si el nombre coincide
 * (insensible a mayúsculas/tildes) con una fila de
 * `EditorialesDescuentosService.descuentos`, se pre-carga su
 * `porcentajePorDefecto` — pero nunca si el vendedor ya tocó el campo a mano
 * (`descuentoTocadoManualmente`), para no pisar una corrección explícita.
 */
@Component({
  selector: 'app-catalogar-libro',
  imports: [ReactiveFormsModule],
  templateUrl: './catalogar-libro.component.html',
})
export class CatalogarLibroComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);
  private readonly metadatosService = inject(MetadatosService);
  private readonly editorialesDescuentosService = inject(EditorialesDescuentosService);

  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly errorEspacios = this.ubicacionFisicaService.errorEspacios;
  protected readonly muebles = this.ubicacionFisicaService.muebles;
  protected readonly ubicaciones = this.ubicacionFisicaService.ubicaciones;
  protected readonly errorUbicaciones = this.ubicacionFisicaService.errorUbicaciones;

  /** Panel "Ubicación del libro" — persiste entre catalogaciones seguidas, nunca se limpia en `reiniciarFormulario()`. */
  protected readonly panelEspacioId = signal('');
  protected readonly panelMuebleId = signal('');
  protected readonly panelUbicacionId = signal('');

  /** Muebles del espacio elegido en el panel (cascada Espacio → Mueble). */
  protected readonly panelMueblesDelEspacio = computed(() =>
    this.muebles().filter((mueble) => mueble.espacioId === this.panelEspacioId()),
  );
  /** Ubicaciones del mueble elegido en el panel (cascada Mueble → Ubicación). */
  protected readonly panelUbicacionesDelMueble = computed(() =>
    this.ubicaciones().filter((ubicacion) => ubicacion.muebleId === this.panelMuebleId()),
  );

  /** `true` si el vendedor ya editó `porcentajeDescuentoEditorial` a mano — bloquea el autocompletado hasta la próxima catalogación. */
  protected readonly descuentoTocadoManualmente = signal(false);

  protected readonly guardando = signal(false);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** `true` mientras se consulta `MetadatosService` tras obtener un ISBN (escaneo o entrada manual). */
  protected readonly buscandoMetadatos = signal(false);
  /** `true` cuando la última búsqueda de metadatos no encontró ningún dato — mensaje neutral, no bloqueante. */
  protected readonly metadatosNoEncontrados = signal(false);

  /** Candidatos de la última búsqueda por título/autor (`GET /api/metadatos/buscar`) — para cuando el vendedor no tiene ISBN a mano. */
  protected readonly candidatos = signal<CandidatoLibro[]>([]);
  /** `true` mientras se consulta `MetadatosService.buscarCandidatos`. */
  protected readonly buscandoCandidatos = signal(false);
  /** `true` cuando la última búsqueda por título/autor no encontró ningún candidato — mensaje neutral, no bloqueante. */
  protected readonly candidatosNoEncontrados = signal(false);
  /** `true` mientras se busca el PVP por título/autor (`MetadatosService.buscarPvp`) tras elegir un candidato sin ISBN. */
  protected readonly buscandoPvpCandidato = signal(false);

  /** Referencia al `<video>` que muestra la vista de la cámara mientras se escanea. */
  private readonly videoEscaner = viewChild<ElementRef<HTMLVideoElement>>('videoEscaner');

  protected readonly escaneando = signal(false);
  protected readonly errorEscaneo = signal<string | null>(null);
  private controlesEscaner: IScannerControls | null = null;

  protected readonly formulario = this.fb.nonNullable.group({
    isbn: [''],
    titulo: ['', Validators.required],
    autor: ['', Validators.required],
    editorial: [''],
    portadaUrl: [''],
    pvp: [0, [Validators.required, Validators.min(1), Validators.max(PVP_MAXIMO)]],
    porcentajeDescuentoEditorial: [35, [Validators.required, Validators.min(0), Validators.max(100)]],
    cantidadTotal: [1, [Validators.required, Validators.min(1)]],
  });

  ngOnInit(): void {
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();
    void this.editorialesDescuentosService.cargarDescuentos();
  }

  /** Cambiar el Espacio en el panel recalcula las opciones de Mueble y limpia la selección previa (cascada) — mismo patrón que `GestionUbicacionFisicaComponent`. */
  protected alCambiarPanelEspacio(): void {
    this.panelMuebleId.set('');
    this.panelUbicacionId.set('');
  }

  /** Cambiar el Mueble en el panel recalcula las opciones de Ubicación y limpia la selección previa (cascada). */
  protected alCambiarPanelMueble(): void {
    this.panelUbicacionId.set('');
  }

  /** Marca `porcentajeDescuentoEditorial` como tocado a mano — bloquea el autocompletado hasta la próxima catalogación (`reiniciarFormulario`). */
  protected marcarDescuentoTocadoManualmente(): void {
    this.descuentoTocadoManualmente.set(true);
  }

  /**
   * Se dispara al perder el foco el campo Editorial cuando se escribe a
   * mano. Autocompleta `porcentajeDescuentoEditorial` si el nombre coincide
   * con una fila configurada — mismo trigger interno que usan
   * `buscarYPrecargarMetadatos`/`seleccionarCandidato` cuando la editorial
   * llega por escaneo/búsqueda.
   */
  protected alPerderFocoEditorial(): void {
    this.autocompletarDescuentoEditorial(this.formulario.controls.editorial.value);
  }

  /**
   * Autocompleta `porcentajeDescuentoEditorial` con el `porcentajePorDefecto`
   * configurado para la editorial (comparación insensible a
   * mayúsculas/tildes, `normalizarTexto`) — nunca si el vendedor ya tocó el
   * campo a mano (`descuentoTocadoManualmente`).
   */
  private autocompletarDescuentoEditorial(nombreEditorial: string): void {
    if (this.descuentoTocadoManualmente()) {
      return;
    }
    const normalizado = normalizarTexto(nombreEditorial);
    if (normalizado === '') {
      return;
    }
    const coincidencia = this.editorialesDescuentosService
      .descuentos()
      .find((descuento) => normalizarTexto(descuento.editorial) === normalizado);
    if (coincidencia) {
      this.formulario.controls.porcentajeDescuentoEditorial.setValue(coincidencia.porcentajePorDefecto);
    }
  }

  ngOnDestroy(): void {
    this.detenerEscaneo();
  }

  /**
   * Activa la cámara y comienza a buscar un código EAN-13 (ISBN-13) en el
   * video. Se invoca únicamente desde el gesto de click/tap del botón
   * "Escanear ISBN" — `getUserMedia` requiere una interacción explícita del
   * usuario, en particular en iOS Safari (`CLAUDE.md` §7).
   */
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
            this.formulario.controls.isbn.setValue(resultado.getText());
            this.detenerEscaneo();
            void this.buscarYPrecargarMetadatos(resultado.getText());
          }
          // Los errores de "no encontrado" se disparan en cada frame sin
          // código detectado — no son errores reales, se ignoran.
        },
      );
    } catch {
      this.escaneando.set(false);
      this.errorEscaneo.set('No se pudo acceder a la cámara. Verifica los permisos o ingresa el ISBN manualmente.');
    }
  }

  /** Detiene el escaneo y libera la cámara. */
  protected detenerEscaneo(): void {
    this.controlesEscaner?.stop();
    this.controlesEscaner = null;
    this.escaneando.set(false);
  }

  /** Se dispara al perder el foco el campo ISBN cuando se ingresó manualmente (sin cámara). */
  protected alPerderFocoIsbn(): void {
    void this.buscarYPrecargarMetadatos(this.formulario.controls.isbn.value);
  }

  /**
   * Consulta `MetadatosService` con el ISBN disponible y pre-carga
   * título/autor/editorial/portada/pvp. Por defecto (`sobrescribir: false`,
   * usado por el escaneo con cámara y la entrada manual de ISBN) SOLO
   * completa los campos que el vendedor todavía no llenó a mano — nunca pisa
   * un valor ya escrito (`CLAUDE.md` A08), porque ahí la búsqueda se dispara
   * automáticamente sin que el vendedor haya confirmado nada.
   *
   * `sobrescribir: true` (usado por `seleccionarCandidato` al elegir un
   * candidato CON ISBN) SÍ reemplaza todos los campos, incluidos los que ya
   * tenían un valor: a diferencia del escaneo/entrada manual, aquí el
   * vendedor ya eligió explícitamente ESTE libro exacto de una lista — la
   * ficha confirmada por ISBN es más confiable que lo que haya en el
   * formulario (que pudo venir de otro candidato de texto libre, con datos
   * menos precisos).
   *
   * Si no se encuentra nada o la API falla, el formulario sigue siendo 100%
   * editable manualmente: no hay ningún mensaje bloqueante, solo un aviso
   * neutral opcional.
   */
  private async buscarYPrecargarMetadatos(isbn: string, opciones: { sobrescribir?: boolean } = {}): Promise<void> {
    const isbnLimpio = isbn.trim();
    if (isbnLimpio === '') {
      return;
    }
    const sobrescribir = opciones.sobrescribir ?? false;

    this.metadatosNoEncontrados.set(false);
    this.buscandoMetadatos.set(true);
    try {
      const metadatos = await this.metadatosService.obtenerMetadatos(isbnLimpio);
      const controles = this.formulario.controls;

      if ((sobrescribir || controles.titulo.value.trim() === '') && metadatos.titulo) {
        controles.titulo.setValue(metadatos.titulo);
      }
      if ((sobrescribir || controles.autor.value.trim() === '') && metadatos.autor) {
        controles.autor.setValue(metadatos.autor);
      }
      if ((sobrescribir || controles.editorial.value.trim() === '') && metadatos.editorial) {
        controles.editorial.setValue(metadatos.editorial);
        this.autocompletarDescuentoEditorial(metadatos.editorial);
      }
      if ((sobrescribir || controles.portadaUrl.value.trim() === '') && metadatos.portadaUrl) {
        controles.portadaUrl.setValue(metadatos.portadaUrl);
      }
      // Criterio de "vacío" para un campo numérico: su valor por defecto (0)
      // del formulario, no un string vacío.
      if ((sobrescribir || controles.pvp.value === 0) && metadatos.pvp) {
        controles.pvp.setValue(metadatos.pvp);
      }

      if (
        !metadatos.titulo && !metadatos.autor && !metadatos.editorial
        && !metadatos.portadaUrl && !metadatos.pvp
      ) {
        this.metadatosNoEncontrados.set(true);
      }
    } finally {
      this.buscandoMetadatos.set(false);
    }
  }

  /**
   * Busca candidatos por título/autor (`MetadatosService.buscarCandidatos`)
   * para cuando el vendedor no tiene el ISBN a mano (`TODO.md`, Tarea de
   * búsqueda por título/autor). Se dispara desde el botón "Buscar por título
   * y autor", visible solo mientras el campo `isbn` está vacío.
   */
  protected async buscarCandidatos(): Promise<void> {
    const titulo = this.formulario.controls.titulo.value.trim();
    const autor = this.formulario.controls.autor.value.trim();
    if (titulo === '' && autor === '') {
      return;
    }

    this.candidatosNoEncontrados.set(false);
    this.candidatos.set([]);
    this.buscandoCandidatos.set(true);
    try {
      const resultado = await this.metadatosService.buscarCandidatos(titulo, autor);
      this.candidatos.set(resultado);
      if (resultado.length === 0) {
        this.candidatosNoEncontrados.set(true);
      }
    } finally {
      this.buscandoCandidatos.set(false);
    }
  }

  /**
   * Pre-carga el candidato elegido en el formulario — a diferencia del
   * escaneo/entrada manual de ISBN, aquí el vendedor ya confirmó
   * explícitamente ESTE libro exacto de una lista, así que se SOBRESCRIBEN
   * todos los campos (título/autor/editorial/portada), incluso los que ya
   * tenían un valor (ej. lo que el vendedor haya escrito para buscar). Si el
   * candidato trae `isbn`, además lo completa y reutiliza
   * `buscarYPrecargarMetadatos` con `sobrescribir: true` (ya existente) para
   * refinar esos mismos campos y resolver el PVP con la ficha confirmada por
   * ISBN — más precisa que los datos de la búsqueda de texto libre (ver
   * ejemplo real: título/autor en mayúsculas correctas, editorial exacta).
   * Si NO trae `isbn`, busca el PVP directamente por título/autor
   * (`buscarPvpCandidatoSinIsbn`, abajo) — Lerner y Nacional primero,
   * Tornamesa como último recurso; si ninguno encuentra precio, el PVP
   * queda como estaba. Cierra la lista de candidatos tras seleccionar uno.
   */
  protected async seleccionarCandidato(candidato: CandidatoLibro): Promise<void> {
    const controles = this.formulario.controls;

    controles.titulo.setValue(candidato.titulo);
    if (candidato.autor) {
      controles.autor.setValue(candidato.autor);
    }
    if (candidato.editorial) {
      controles.editorial.setValue(candidato.editorial);
      this.autocompletarDescuentoEditorial(candidato.editorial);
    }
    if (candidato.portadaUrl) {
      controles.portadaUrl.setValue(candidato.portadaUrl);
    }

    this.candidatos.set([]);
    this.candidatosNoEncontrados.set(false);

    if (candidato.isbn) {
      controles.isbn.setValue(candidato.isbn);
      await this.buscarYPrecargarMetadatos(candidato.isbn, { sobrescribir: true });
      return;
    }

    await this.buscarPvpCandidatoSinIsbn(candidato);
  }

  /**
   * Busca el PVP por título/autor (`MetadatosService.buscarPvp`) para un
   * candidato SIN ISBN — a diferencia del flujo por ISBN, esta búsqueda solo
   * resuelve precio, nunca título/autor/editorial/portada (ya precargados
   * desde el propio candidato en `seleccionarCandidato`). Igual que ahí, se
   * SOBRESCRIBE el PVP si la búsqueda encuentra uno (selección explícita del
   * vendedor); si ninguna fuente encuentra precio, el campo queda como
   * estaba (no hay nada más confiable con qué reemplazarlo).
   */
  private async buscarPvpCandidatoSinIsbn(candidato: CandidatoLibro): Promise<void> {
    this.buscandoPvpCandidato.set(true);
    try {
      const pvp = await this.metadatosService.buscarPvp(candidato.titulo, candidato.autor ?? '');
      if (pvp) {
        this.formulario.controls.pvp.setValue(pvp);
      }
    } finally {
      this.buscandoPvpCandidato.set(false);
    }
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const ubicacionId = this.panelUbicacionId();
    if (!ubicacionId) {
      this.mensajeError.set('Selecciona la ubicación del libro (Espacio, Mueble y Ubicación) antes de guardar.');
      return;
    }

    const valores = this.formulario.getRawValue();
    const cuerpo = {
      isbn: valores.isbn.trim() === '' ? null : valores.isbn.trim(),
      titulo: valores.titulo,
      autor: valores.autor,
      editorial: valores.editorial.trim() === '' ? null : valores.editorial.trim(),
      portadaUrl: valores.portadaUrl.trim() === '' ? null : valores.portadaUrl.trim(),
      pvp: valores.pvp,
      porcentajeDescuentoEditorial: valores.porcentajeDescuentoEditorial,
      cantidadTotal: valores.cantidadTotal,
      ubicacionId,
    };

    this.guardando.set(true);
    try {
      const idToken = await this.authService.obtenerIdToken();
      if (!idToken) {
        this.mensajeError.set('No se pudo catalogar el libro. Intenta de nuevo.');
        return;
      }

      const libroCreado = await firstValueFrom(
        this.http.post<{ titulo: string }>('/api/libros', cuerpo, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );

      this.mensajeExito.set(`«${libroCreado.titulo}» catalogado correctamente.`);
      this.reiniciarFormulario();
    } catch (error) {
      const mensaje =
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'No se pudo catalogar el libro. Intenta de nuevo.';
      this.mensajeError.set(mensaje);
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Limpia el formulario tras un guardado exitoso, conservando
   * `porcentajeDescuentoEditorial` (típicamente el mismo entre libros
   * seguidos de la misma editorial) — agiliza la catalogación en serie.
   *
   * A diferencia del resto del formulario, el panel "Ubicación del libro"
   * (`panelEspacioId`/`panelMuebleId`/`panelUbicacionId`) NUNCA se limpia
   * aquí — persiste entre catalogaciones seguidas a propósito
   * (`ajustes-finales.md` §"Catalogar"). `descuentoTocadoManualmente` sí se
   * reinicia: el próximo libro puede ser de otra editorial y merece su
   * propio autocompletado.
   */
  private reiniciarFormulario(): void {
    this.candidatos.set([]);
    this.candidatosNoEncontrados.set(false);
    this.descuentoTocadoManualmente.set(false);
    const porcentajeActual = this.formulario.controls.porcentajeDescuentoEditorial.value;
    this.formulario.reset({
      isbn: '',
      titulo: '',
      autor: '',
      editorial: '',
      portadaUrl: '',
      pvp: 0,
      porcentajeDescuentoEditorial: porcentajeActual,
      cantidadTotal: 1,
    });
  }
}
