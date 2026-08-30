import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { IScannerControls } from '@zxing/browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EditorialesDescuentosService } from '../../core/api/editoriales-descuentos.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { MetadatosService, type CandidatoLibro } from '../../core/api/metadatos.service';
import { LibrosService, type LibroIndice } from '../../core/api/libros.service';
import type { LibroConUbicacion } from '../../core/models/libro.model';
import { SelectorPortadaComponent } from '../../shared/selector-portada/selector-portada.component';

const PVP_MAXIMO = 5_000_000;

/** Tope de candidatos de Babel mostrados por búsqueda — mismo criterio que `LIMITE_CANDIDATOS` del backend (`metadatos.ts`, búsqueda externa). */
const LIMITE_CANDIDATOS_BABEL = 20;

/** Quita tildes y normaliza mayúsculas para comparar nombres de editorial sin distinguir acentos/mayúsculas — mismo criterio que `catalogo-publico.component.ts`. */
function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Candidato de la lista de "Buscar por título y autor" con su origen
 * marcado (Tarea 3 del lote de duplicados, `docs/plan-duplicados-catalogacion.md`
 * §6): `'babel'` cuando viene del índice ligero del propio catálogo
 * (`LibrosService.indice`, ya en Babel — se muestra con una etiqueta "Ya en
 * el catálogo") o `'externo'` cuando viene de `MetadatosService.buscarCandidatos`
 * (APIs de terceros). Un candidato de Babel siempre trae `bookId` — es lo
 * que permite resolver la ficha completa y entrar por el mismo camino de
 * duplicados de la Tarea 1 al elegirlo (`seleccionarCandidato`).
 */
type CandidatoConOrigen =
  | (CandidatoLibro & { origen: 'externo' })
  | (CandidatoLibro & { origen: 'babel'; bookId: string });

/**
 * Pestaña "Catalogar" del área "Gestionar" (`/catalogar`, `TODO.md`) —
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
 *
 * Duplicados por ISBN (`docs/plan-duplicados-catalogacion.md` Tarea 1): al
 * detectar el ISBN en `babel-libros` (`GET /api/libros/por-isbn/:isbn`), se
 * clasifica cada coincidencia contra el panel "Ubicación del libro" ya
 * elegido. Si coincide en la MISMA ubicación (`duplicadoEnMismaUbicacion`),
 * el flujo es bloqueante: todo el formulario queda `disable()` salvo
 * `cantidadTotal` (que pasa a representar el TOTAL existente, no ejemplares
 * nuevos) y el botón cambia a "Editar libro" — al guardar se envía solo la
 * DIFERENCIA a `POST /api/libros/:bookId/fusionar-duplicado`. Si coincide en
 * OTRA ubicación, es solo informativo: los campos siguen editables y
 * "Catalogar libro" sigue creando un libro nuevo e independiente en la
 * ubicación elegida (mover un ejemplar existente a otra ubicación es tarea
 * de `EditarLibroComponent`, no de este flujo). La clasificación es
 * reactiva (`computed`): si el vendedor cambia el panel de ubicación
 * después de detectar el duplicado, el caso se reclasifica solo.
 */
@Component({
  selector: 'app-catalogar-libro',
  imports: [ReactiveFormsModule, SelectorPortadaComponent],
  templateUrl: './catalogar-libro.component.html',
})
export class CatalogarLibroComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);
  private readonly metadatosService = inject(MetadatosService);
  private readonly editorialesDescuentosService = inject(EditorialesDescuentosService);
  private readonly librosService = inject(LibrosService);

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

  /** Visibilidad del diálogo de selección manual de portada (`SelectorPortadaComponent`) — para placeholders genéricos sin palabra clave detectable. */
  protected readonly selectorPortadaVisible = signal(false);

  /**
   * Candidatos de la última búsqueda por título/autor — para cuando el
   * vendedor no tiene ISBN a mano. Primero se filtra `LibrosService.indice`
   * en memoria (`origen: 'babel'`); solo si no hay ninguna coincidencia ahí
   * se recurre a `GET /api/metadatos/buscar` (`origen: 'externo'`, Tarea 3
   * del lote de duplicados, `docs/plan-duplicados-catalogacion.md` §6).
   */
  protected readonly candidatos = signal<CandidatoConOrigen[]>([]);
  /** `true` mientras se consulta `MetadatosService.buscarCandidatos`. */
  protected readonly buscandoCandidatos = signal(false);
  /** `true` cuando la última búsqueda por título/autor no encontró ningún candidato — mensaje neutral, no bloqueante. */
  protected readonly candidatosNoEncontrados = signal(false);
  /** `true` mientras se busca el PVP por título/autor (`MetadatosService.buscarPvp`) tras elegir un candidato sin ISBN. */
  protected readonly buscandoPvpCandidato = signal(false);

  /** Coincidencias de `GET /api/libros/por-isbn/:isbn` cuando hay MÁS de una — lista para elegir cuál editar (`TODO.md` Tarea 2.3). Vacío en cualquier otro caso (0 coincidencias, o ya se seleccionó una). */
  protected readonly coincidenciasIsbn = signal<LibroConUbicacion[]>([]);
  /** El libro ya catalogado sobre el que se está trabajando (1 coincidencia automática, o elegido de `coincidenciasIsbn`) — `null` mientras se cataloga uno nuevo. Al guardar con este signal en no-`null`, `guardar()` fusiona contra `POST /api/libros/:bookId/fusionar-duplicado` en vez de `POST /api/libros` (TODO.md Tarea 2.3). */
  protected readonly libroDuplicadoSeleccionado = signal<LibroConUbicacion | null>(null);
  /** `true` mientras se consulta `GET /api/libros/por-isbn/:isbn` — el botón "Catalogar libro" se deshabilita también mientras esto o `buscandoMetadatos()` estén en curso, para que no se pueda guardar contra un `bookId` de duplicado ya obsoleto si el vendedor cambió el ISBN y no esperó (corrección de condición de carrera, MEMORY.md). */
  protected readonly buscandoDuplicados = signal(false);

  /**
   * `true` cuando el duplicado detectado (`libroDuplicadoSeleccionado`) ya
   * existe en la MISMA ubicación elegida en el panel — el caso bloqueante
   * (`docs/plan-duplicados-catalogacion.md` §4). Depende de dos signals
   * (`libroDuplicadoSeleccionado`/`panelUbicacionId`), así que se recalcula
   * solo si el vendedor cambia el panel DESPUÉS de detectar el duplicado —
   * no hace falta volver a disparar la búsqueda por ISBN para reclasificar.
   */
  protected readonly duplicadoEnMismaUbicacion = computed(() => {
    const duplicado = this.libroDuplicadoSeleccionado();
    return duplicado !== null && duplicado.ubicacionId === this.panelUbicacionId();
  });

  /**
   * `true` mientras `cantidadTotal` está mostrando el TOTAL existente del
   * duplicado (precargado por el `effect` del constructor cuando
   * `duplicadoEnMismaUbicacion()` es `true`) — permite revertir a `1`
   * ("ejemplares nuevos") al salir de ese estado sin pisar un valor que el
   * vendedor haya escrito libremente en cualquier otro caso (sin duplicado,
   * o duplicado en otra ubicación).
   */
  private cantidadReflejaTotalExistente = false;

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

  /**
   * Reacciona a `duplicadoEnMismaUbicacion()`: en el caso bloqueante,
   * deshabilita todo el formulario salvo `cantidadTotal` y la precarga con
   * el TOTAL existente del duplicado; al salir de ese estado (duplicado
   * descartado, ISBN cambiado, o el vendedor movió el panel a otra
   * ubicación), reactiva los campos y — solo si `cantidadTotal` seguía
   * mostrando ese total (`cantidadReflejaTotalExistente`) — la revierte a
   * `1`. No usa signals para las mutaciones de `FormGroup` (no aplica la
   * restricción de escritura de signals dentro de `effect`).
   */
  constructor() {
    effect(() => {
      const duplicado = this.libroDuplicadoSeleccionado();
      const mismaUbicacion = this.duplicadoEnMismaUbicacion();
      const controles = this.formulario.controls;
      const controlesBloqueables = [
        controles.isbn,
        controles.titulo,
        controles.autor,
        controles.editorial,
        controles.portadaUrl,
        controles.pvp,
        controles.porcentajeDescuentoEditorial,
      ];

      if (mismaUbicacion && duplicado) {
        controlesBloqueables.forEach((control) => control.disable());
        controles.cantidadTotal.setValue(duplicado.cantidadTotal);
        this.cantidadReflejaTotalExistente = true;
      } else {
        controlesBloqueables.forEach((control) => control.enable());
        if (this.cantidadReflejaTotalExistente) {
          controles.cantidadTotal.setValue(1);
          this.cantidadReflejaTotalExistente = false;
        }
      }
    });
  }

  ngOnInit(): void {
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();
    void this.editorialesDescuentosService.cargarDescuentos();
    void this.librosService.cargarIndice();
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
        // `aspectRatio: { ideal: 3 }` es "advisory": le pide al navegador un
        // stream horizontal (~3:1, EAN-13) cuando lo soporta, pero no lo
        // garantiza en todos los navegadores/dispositivos — el recorte CSS
        // (`aspect-[3/1] object-cover` en la plantilla) es lo único que
        // garantiza el resultado visual final (`TODO.md` Tarea 2.1).
        { video: { facingMode: 'environment', aspectRatio: { ideal: 3 } } },
        video,
        (resultado) => {
          if (resultado) {
            this.formulario.controls.isbn.setValue(resultado.getText());
            this.detenerEscaneo();
            void this.dispararBusquedaPorIsbn(resultado.getText());
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
    void this.dispararBusquedaPorIsbn(this.formulario.controls.isbn.value);
  }

  /** Reemplaza `portadaUrl` con la elegida en `SelectorPortadaComponent` y cierra el diálogo. */
  protected alSeleccionarPortada(url: string): void {
    this.formulario.controls.portadaUrl.setValue(url);
    this.selectorPortadaVisible.set(false);
  }

  /**
   * Busca primero en **Babel** (`buscarDuplicadosPorIsbn`, `GET
   * /api/libros/por-isbn/:isbn`) — la propia base de datos, más confiable, es
   * siempre la primera fuente al escanear/escribir un ISBN
   * (`docs/plan-duplicados-catalogacion.md` §3). Si el ISBN ya está
   * catalogado, la búsqueda de metadatos externos (`api.letiende.co` +
   * scraping, varios segundos) NI SIQUIERA SE LLAMA: los datos de Babel ya
   * son la ficha completa y más confiable. Solo si Babel no tiene nada se
   * cae al fallback externo (`buscarYPrecargarMetadatos`). Punto de disparo
   * único para escaneo, blur del ISBN manual y selección de un candidato con
   * ISBN.
   *
   * El reset de `libroDuplicadoSeleccionado`/`coincidenciasIsbn`/
   * `metadatosNoEncontrados` ocurre aquí, de forma SÍNCRONA, ANTES de
   * cualquier `await` — no depende de que termine ninguna de las dos
   * búsquedas primero. Corrige una condición de carrera (MEMORY.md): si
   * dependiera de `buscarDuplicadosPorIsbn` (que corre después de ese
   * `await`), un vendedor que cambia el ISBN y pulsa "Catalogar libro"
   * durante esa ventana podía guardar contra el `bookId` de un duplicado ya
   * obsoleto, corrompiendo un libro sin relación con lo que pensaba guardar.
   */
  private async dispararBusquedaPorIsbn(isbn: string, opciones: { sobrescribir?: boolean } = {}): Promise<void> {
    this.libroDuplicadoSeleccionado.set(null);
    this.coincidenciasIsbn.set([]);
    this.metadatosNoEncontrados.set(false);

    const huboCoincidenciaEnBabel = await this.buscarDuplicadosPorIsbn(isbn);
    if (huboCoincidenciaEnBabel) {
      return;
    }
    await this.buscarYPrecargarMetadatos(isbn, opciones);
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
   * Busca libros ya catalogados con este ISBN exacto (`GET
   * /api/libros/por-isbn/:isbn`, `docs/plan-duplicados-catalogacion.md` §3) —
   * primera fuente al resolver un ISBN, antes que cualquier búsqueda
   * externa (`dispararBusquedaPorIsbn`). El reset de
   * `libroDuplicadoSeleccionado`/`coincidenciasIsbn` para el nuevo ISBN ya
   * ocurrió de forma síncrona en `dispararBusquedaPorIsbn`, antes de llegar
   * aquí.
   *
   * 0 coincidencias: no hace nada más (ya quedó reseteado), devuelve
   * `false` para que `dispararBusquedaPorIsbn` caiga al fallback externo. 1
   * coincidencia: se selecciona automáticamente (`seleccionarDuplicado`).
   * Varias: quedan en `coincidenciasIsbn` para que el vendedor elija cuál (o
   * las descarte con `descartarDuplicado`). En ambos casos con coincidencia
   * devuelve `true` — la búsqueda externa nunca se llama.
   *
   * Nunca lanza ni bloquea el formulario — ante sesión ausente o cualquier
   * error de red/servidor, devuelve `false` (sin duplicado detectado) y el
   * vendedor sigue pudiendo catalogar manualmente, cayendo al fallback
   * externo como si Babel no tuviera nada.
   */
  private async buscarDuplicadosPorIsbn(isbn: string): Promise<boolean> {
    const isbnLimpio = isbn.trim();
    if (isbnLimpio === '') {
      return false;
    }

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return false;
    }

    this.buscandoDuplicados.set(true);
    try {
      const coincidencias = await firstValueFrom(
        this.http.get<LibroConUbicacion[]>(`/api/libros/por-isbn/${isbnLimpio}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      );
      if (coincidencias.length === 1) {
        this.seleccionarDuplicado(coincidencias[0] as LibroConUbicacion);
        return true;
      } else if (coincidencias.length > 1) {
        this.coincidenciasIsbn.set(coincidencias);
        return true;
      }
      return false;
    } catch {
      // Ante cualquier error, sin duplicado detectado — cae al fallback externo.
      return false;
    } finally {
      this.buscandoDuplicados.set(false);
    }
  }

  /**
   * Precarga el formulario con los datos de un libro ya catalogado
   * (`docs/plan-duplicados-catalogacion.md` §4) — la ficha ya catalogada
   * pisa cualquier dato que haya puesto `buscarYPrecargarMetadatos`, sea
   * cual sea el estado previo de cada campo (más confiable que una búsqueda
   * automática de metadatos externos). `cantidadTotal` se precarga con `1`
   * ("ejemplares nuevos que se suman") — el `effect` del constructor la
   * reemplaza por el TOTAL existente si resulta que el duplicado está en la
   * MISMA ubicación ya elegida en el panel (`duplicadoEnMismaUbicacion`).
   *
   * A diferencia del comportamiento anterior, el panel "Ubicación del
   * libro" YA NO se sobrescribe con la ubicación del duplicado — ese
   * sobreescribir en silencio la elección del vendedor fue la causa real de
   * un libro catalogado dos veces en la misma ubicación en producción (ver
   * `docs/plan-duplicados-catalogacion.md` §1). Si el vendedor ya eligió una
   * ubicación distinta antes de escanear, esa elección se respeta tal cual
   * está — `duplicadoEnMismaUbicacion` decide, comparando contra el panel
   * SIN TOCARLO, si esto es una coincidencia bloqueante (misma ubicación) o
   * solo informativa (otra ubicación).
   */
  protected seleccionarDuplicado(libro: LibroConUbicacion): void {
    this.libroDuplicadoSeleccionado.set(libro);
    this.coincidenciasIsbn.set([]);

    const controles = this.formulario.controls;
    // Precarga también el isbn — necesario para el flujo de la Tarea 3
    // (candidato de Babel elegido por título/autor, sin haber tocado el
    // campo isbn todavía); sin efecto en el flujo por ISBN de la Tarea 1,
    // donde el campo ya tenía este mismo valor.
    controles.isbn.setValue(libro.isbn ?? '');
    controles.titulo.setValue(libro.titulo);
    controles.autor.setValue(libro.autor);
    controles.editorial.setValue(libro.editorial ?? '');
    controles.portadaUrl.setValue(libro.portadaUrl ?? '');
    controles.pvp.setValue(libro.pvp);
    controles.porcentajeDescuentoEditorial.setValue(libro.porcentajeDescuentoEditorial);
    controles.cantidadTotal.setValue(1);
  }

  /** El vendedor descarta el/los duplicado(s) detectado(s) y decide catalogar una entrada nueva independiente — conserva todo lo ya escrito en el formulario (`TODO.md` Tarea 2.3). */
  protected descartarDuplicado(): void {
    this.coincidenciasIsbn.set([]);
    this.libroDuplicadoSeleccionado.set(null);
  }

  /** Texto "Espacio/Mueble/Ubicación" de un duplicado detectado, para la alerta/lista de coincidencias — `null` si algún eslabón de la cadena ya no existe (`resolverUbicacion` en el backend, `CLAUDE.md` A08). */
  protected descripcionUbicacion(ubicacion: { espacio: string; mueble: string; ubicacion: string } | null): string {
    return ubicacion ? `${ubicacion.espacio}/${ubicacion.mueble}/${ubicacion.ubicacion}` : 'sin ubicación';
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

    // Babel primero (Tarea 3, `docs/plan-duplicados-catalogacion.md` §6):
    // filtrado instantáneo en memoria contra el índice ya cargado
    // (`ngOnInit`). Solo si no hay ninguna coincidencia razonable se
    // recurre a la búsqueda externa — nunca en paralelo, para no mostrar
    // resultados de terceros cuando el libro ya está en el propio catálogo.
    const coincidenciasBabel = this.filtrarIndice(titulo, autor);
    if (coincidenciasBabel.length > 0) {
      this.candidatos.set(
        coincidenciasBabel.slice(0, LIMITE_CANDIDATOS_BABEL).map(
          (libro): CandidatoConOrigen => ({
            origen: 'babel',
            bookId: libro.bookId,
            titulo: libro.titulo,
            autor: libro.autor,
            editorial: null,
            portadaUrl: libro.portadaUrl,
            isbn: libro.isbn,
          }),
        ),
      );
      return;
    }

    this.buscandoCandidatos.set(true);
    try {
      const resultado = await this.metadatosService.buscarCandidatos(titulo, autor);
      this.candidatos.set(resultado.map((candidato): CandidatoConOrigen => ({ ...candidato, origen: 'externo' })));
      if (resultado.length === 0) {
        this.candidatosNoEncontrados.set(true);
      }
    } finally {
      this.buscandoCandidatos.set(false);
    }
  }

  /**
   * Filtra `LibrosService.indice` en memoria por título/autor (insensible a
   * mayúsculas/tildes, `normalizarTexto` — mismo criterio que el resto del
   * proyecto). Si el vendedor escribió ambos campos, exige que AMBOS
   * coincidan (no basta con uno); si solo escribió uno, ese es el único
   * criterio (`docs/plan-duplicados-catalogacion.md` §6, "coincidencias
   * razonables").
   */
  private filtrarIndice(titulo: string, autor: string): LibroIndice[] {
    const tituloNormalizado = normalizarTexto(titulo);
    const autorNormalizado = normalizarTexto(autor);
    return this.librosService.indice().filter((libro) => {
      const coincideTitulo = tituloNormalizado === '' || normalizarTexto(libro.titulo).includes(tituloNormalizado);
      const coincideAutor = autorNormalizado === '' || normalizarTexto(libro.autor).includes(autorNormalizado);
      return coincideTitulo && coincideAutor;
    });
  }

  /**
   * Pre-carga el candidato elegido en el formulario. Un candidato de Babel
   * (`origen: 'babel'`, Tarea 3 del lote de duplicados,
   * `docs/plan-duplicados-catalogacion.md` §6) entra por el MISMO camino de
   * duplicados que la Tarea 1: se resuelve la ficha completa por `bookId`
   * (`LibrosService.obtenerDetalle`, el índice ligero no trae editorial ni
   * descuento) y se delega a `seleccionarDuplicado` — que a su vez decide,
   * comparando contra el panel, si esto es un caso bloqueante (misma
   * ubicación) o informativo (otra ubicación), igual que un duplicado
   * detectado por ISBN.
   *
   * Un candidato externo (`origen: 'externo'`) sigue el flujo ya existente:
   * a diferencia del escaneo/entrada manual de ISBN, aquí el vendedor ya
   * confirmó explícitamente ESTE libro exacto de una lista, así que se
   * SOBRESCRIBEN todos los campos (título/autor/editorial/portada), incluso
   * los que ya tenían un valor. Si el candidato trae `isbn`, además lo
   * completa y reutiliza `buscarYPrecargarMetadatos` con `sobrescribir:
   * true` (ya existente) para refinar esos mismos campos y resolver el PVP
   * con la ficha confirmada por ISBN — más precisa que los datos de la
   * búsqueda de texto libre. Si NO trae `isbn`, busca el PVP directamente
   * por título/autor (`buscarPvpCandidatoSinIsbn`, abajo). Cierra la lista
   * de candidatos tras seleccionar uno, en ambos casos.
   */
  protected async seleccionarCandidato(candidato: CandidatoConOrigen): Promise<void> {
    this.candidatos.set([]);
    this.candidatosNoEncontrados.set(false);

    if (candidato.origen === 'babel') {
      const libro = await this.librosService.obtenerDetalle(candidato.bookId);
      if (libro) {
        this.seleccionarDuplicado(libro);
      }
      return;
    }

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

    if (candidato.isbn) {
      controles.isbn.setValue(candidato.isbn);
      await this.dispararBusquedaPorIsbn(candidato.isbn, { sobrescribir: true });
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
    const duplicado = this.libroDuplicadoSeleccionado();
    const mismaUbicacion = this.duplicadoEnMismaUbicacion();

    // Caso bloqueante (`docs/plan-duplicados-catalogacion.md` §4): el
    // vendedor ve el TOTAL existente en `cantidadTotal` y debe AUMENTARLO —
    // el delta (nunca un total absoluto) es lo único que viaja al backend,
    // igual que antes, para no reabrir la condición de carrera que corrige
    // `fusionar-duplicado` (dos vendedores editando el mismo duplicado casi
    // al mismo tiempo perderían ejemplares, MEMORY.md). Un delta no positivo
    // (número igual o menor al existente) no envía nada — reducir ejemplares
    // es tarea de la pestaña Editar, no de este flujo.
    let delta = 0;
    if (mismaUbicacion && duplicado) {
      delta = valores.cantidadTotal - duplicado.cantidadTotal;
      if (delta <= 0) {
        this.mensajeError.set(
          'La cantidad no puede ser igual o menor a la que ya existe en esta ubicación. ' +
            'Para reducir ejemplares, hazlo desde la pestaña Editar.',
        );
        return;
      }
    }

    const camposComunes = {
      isbn: valores.isbn.trim() === '' ? null : valores.isbn.trim(),
      titulo: valores.titulo,
      autor: valores.autor,
      editorial: valores.editorial.trim() === '' ? null : valores.editorial.trim(),
      portadaUrl: valores.portadaUrl.trim() === '' ? null : valores.portadaUrl.trim(),
      pvp: valores.pvp,
      porcentajeDescuentoEditorial: valores.porcentajeDescuentoEditorial,
    };

    this.guardando.set(true);
    try {
      const idToken = await this.authService.obtenerIdToken();
      if (!idToken) {
        this.mensajeError.set('No se pudo catalogar el libro. Intenta de nuevo.');
        return;
      }

      if (mismaUbicacion && duplicado) {
        // Endpoint dedicado de fusión atómica
        // (`POST /api/libros/:bookId/fusionar-duplicado`) en vez de `PUT` —
        // el backend SUMA `ejemplaresNuevos` a
        // `cantidadTotal`/`cantidadDisponible` con un único `UpdateItem`
        // atómico (`ADD`), sin leer el total actual primero.
        const libroActualizado = await firstValueFrom(
          this.http.post<{ titulo: string }>(
            `/api/libros/${duplicado.bookId}/fusionar-duplicado`,
            { ...camposComunes, ubicacionId, ejemplaresNuevos: delta },
            { headers: { Authorization: `Bearer ${idToken}` } },
          ),
        );
        this.mensajeExito.set(`«${libroActualizado.titulo}» actualizado — se agregaron ${delta} ejemplares nuevos.`);
      } else {
        // Libro nuevo e independiente — también cuando hay un duplicado
        // detectado en OTRA ubicación (caso informativo): un ejemplar del
        // mismo ISBN en una ubicación distinta es un `bookId` propio, nunca
        // una fusión con el libro de la otra ubicación (mover un ejemplar
        // existente a otra ubicación es tarea de `EditarLibroComponent`).
        const libroCreado = await firstValueFrom(
          this.http.post<{ titulo: string }>(
            '/api/libros',
            { ...camposComunes, cantidadTotal: valores.cantidadTotal, ubicacionId },
            { headers: { Authorization: `Bearer ${idToken}` } },
          ),
        );
        this.mensajeExito.set(`«${libroCreado.titulo}» catalogado correctamente.`);
      }
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
    this.coincidenciasIsbn.set([]);
    this.libroDuplicadoSeleccionado.set(null);
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
