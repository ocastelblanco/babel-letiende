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
import type { LibroConUbicacion } from '../../core/models/libro.model';

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

  /** Coincidencias de `GET /api/libros/por-isbn/:isbn` cuando hay MÁS de una — lista para elegir cuál editar (`TODO.md` Tarea 2.3). Vacío en cualquier otro caso (0 coincidencias, o ya se seleccionó una). */
  protected readonly coincidenciasIsbn = signal<LibroConUbicacion[]>([]);
  /** El libro ya catalogado sobre el que se está trabajando (1 coincidencia automática, o elegido de `coincidenciasIsbn`) — `null` mientras se cataloga uno nuevo. Al guardar con este signal en no-`null`, `guardar()` fusiona contra `POST /api/libros/:bookId/fusionar-duplicado` en vez de `POST /api/libros` (TODO.md Tarea 2.3). */
  protected readonly libroDuplicadoSeleccionado = signal<LibroConUbicacion | null>(null);
  /** `true` mientras se consulta `GET /api/libros/por-isbn/:isbn` — el botón "Catalogar libro" se deshabilita también mientras esto o `buscandoMetadatos()` estén en curso, para que no se pueda guardar contra un `bookId` de duplicado ya obsoleto si el vendedor cambió el ISBN y no esperó (corrección de condición de carrera, MEMORY.md). */
  protected readonly buscandoDuplicados = signal(false);

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

  /**
   * Encadena `buscarYPrecargarMetadatos` (metadatos externos) y
   * `buscarDuplicadosPorIsbn` (libros ya catalogados) para el mismo ISBN —
   * en ese orden, nunca en paralelo, para que la ficha ya catalogada (más
   * confiable) pueda pisar de forma determinista lo que la búsqueda de
   * metadatos externos haya precargado (`TODO.md` Tarea 2.3, precedencia de
   * datos). Punto de disparo único para escaneo, blur del ISBN manual y
   * selección de un candidato con ISBN.
   *
   * El reset de `libroDuplicadoSeleccionado`/`coincidenciasIsbn` ocurre aquí,
   * de forma SÍNCRONA, ANTES de cualquier `await` — no depende de que
   * termine `buscarYPrecargarMetadatos` primero. Corrige una condición de
   * carrera (MEMORY.md): si dependiera de `buscarDuplicadosPorIsbn` (que
   * solo corre después de esa primera espera), un vendedor que cambia el
   * ISBN y pulsa "Catalogar libro" durante esa ventana podía guardar contra
   * el `bookId` de un duplicado ya obsoleto, corrompiendo un libro sin
   * relación con lo que pensaba guardar.
   */
  private async dispararBusquedaPorIsbn(isbn: string, opciones: { sobrescribir?: boolean } = {}): Promise<void> {
    this.libroDuplicadoSeleccionado.set(null);
    this.coincidenciasIsbn.set([]);
    await this.buscarYPrecargarMetadatos(isbn, opciones);
    await this.buscarDuplicadosPorIsbn(isbn);
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
   * Busca libros ya catalogados con este ISBN exacto
   * (`GET /api/libros/por-isbn/:isbn`, `TODO.md` Tarea 2.3) para evitar
   * duplicados — siempre se dispara DESPUÉS de `buscarYPrecargarMetadatos`
   * (`dispararBusquedaPorIsbn`), nunca antes, para que sus datos (la ficha ya
   * catalogada, más confiable) puedan pisar lo que la búsqueda de metadatos
   * externos haya precargado. El reset de `libroDuplicadoSeleccionado`/
   * `coincidenciasIsbn` para el nuevo ISBN ya ocurrió de forma síncrona en
   * `dispararBusquedaPorIsbn`, antes de llegar aquí.
   *
   * 0 coincidencias: no hace nada más (ya quedó reseteado). 1 coincidencia:
   * se selecciona automáticamente (`seleccionarDuplicado`). Varias: quedan
   * en `coincidenciasIsbn` para que el vendedor elija cuál (o las descarte
   * con `descartarDuplicado`).
   *
   * Nunca lanza ni bloquea el formulario — mismo criterio que
   * `buscarYPrecargarMetadatos`: ante sesión ausente o cualquier error de
   * red/servidor, el vendedor sigue pudiendo catalogar manualmente sin
   * ningún duplicado detectado.
   */
  private async buscarDuplicadosPorIsbn(isbn: string): Promise<void> {
    const isbnLimpio = isbn.trim();
    if (isbnLimpio === '') {
      return;
    }

    const idToken = await this.authService.obtenerIdToken();
    if (!idToken) {
      return;
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
      } else if (coincidencias.length > 1) {
        this.coincidenciasIsbn.set(coincidencias);
      }
    } catch {
      // Ante cualquier error, sin duplicado detectado — no bloquea el formulario.
    } finally {
      this.buscandoDuplicados.set(false);
    }
  }

  /**
   * Precarga TODO el formulario con los datos de un libro ya catalogado
   * (`TODO.md` Tarea 2.3) — la ficha ya catalogada pisa cualquier dato que
   * haya puesto `buscarYPrecargarMetadatos`, sea cual sea el estado previo de
   * cada campo (más confiable que una búsqueda automática de metadatos
   * externos). También actualiza el panel "Ubicación del libro" para que
   * coincida con la ubicación del duplicado, resolviendo espacioId/muebleId
   * desde ubicacionId (cascada, mismo patrón que
   * `EditarLibroComponent.editar`). `cantidadTotal` NO se llena con la
   * cantidad existente del duplicado — se resetea a 1: a partir de aquí
   * representa "ejemplares nuevos que se suman", no el total (decisión de
   * producto ya confirmada, `TODO.md`).
   */
  protected seleccionarDuplicado(libro: LibroConUbicacion): void {
    this.libroDuplicadoSeleccionado.set(libro);
    this.coincidenciasIsbn.set([]);

    const controles = this.formulario.controls;
    controles.titulo.setValue(libro.titulo);
    controles.autor.setValue(libro.autor);
    controles.editorial.setValue(libro.editorial ?? '');
    controles.portadaUrl.setValue(libro.portadaUrl ?? '');
    controles.pvp.setValue(libro.pvp);
    controles.porcentajeDescuentoEditorial.setValue(libro.porcentajeDescuentoEditorial);
    controles.cantidadTotal.setValue(1);

    const ubicacionActual = this.ubicaciones().find((ubicacion) => ubicacion.ubicacionId === libro.ubicacionId);
    const muebleActual = ubicacionActual
      ? this.muebles().find((mueble) => mueble.muebleId === ubicacionActual.muebleId)
      : undefined;
    this.panelEspacioId.set(muebleActual?.espacioId ?? '');
    this.panelMuebleId.set(ubicacionActual?.muebleId ?? '');
    this.panelUbicacionId.set(libro.ubicacionId ?? '');
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

      if (duplicado) {
        // Editando un duplicado ya catalogado (`TODO.md` Tarea 2.3): usa el
        // endpoint dedicado de fusión atómica
        // (`POST /api/libros/:bookId/fusionar-duplicado`) en vez de `PUT` —
        // el backend SUMA `ejemplaresNuevos` a
        // `cantidadTotal`/`cantidadDisponible` con un único `UpdateItem`
        // atómico (`ADD`), sin leer el total actual primero. Enviar
        // `ejemplaresNuevos: valores.cantidadTotal` tal cual lo escribió el
        // vendedor — el CLIENTE NUNCA calcula un total absoluto
        // ("existente + nuevo"): hacerlo aquí reabre la condición de carrera
        // que este endpoint corrige (dos vendedores fusionando el mismo
        // duplicado casi al mismo tiempo perderían ejemplares, MEMORY.md).
        const libroActualizado = await firstValueFrom(
          this.http.post<{ titulo: string }>(
            `/api/libros/${duplicado.bookId}/fusionar-duplicado`,
            { ...camposComunes, ubicacionId, ejemplaresNuevos: valores.cantidadTotal },
            { headers: { Authorization: `Bearer ${idToken}` } },
          ),
        );
        this.mensajeExito.set(
          `«${libroActualizado.titulo}» actualizado — se agregaron ${valores.cantidadTotal} ejemplares nuevos.`,
        );
      } else {
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
