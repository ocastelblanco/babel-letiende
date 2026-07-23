import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { IScannerControls } from '@zxing/browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EstantesService } from '../../core/api/estantes.service';
import { MetadatosService, type CandidatoLibro } from '../../core/api/metadatos.service';

const PVP_MAXIMO = 5_000_000;

/**
 * Flujo de catalogación (`TODO.md`, roadmap Alta) — captura los campos del
 * libro contra `POST /api/libros`, ya verificado en vivo. El ISBN puede
 * llegar por escaneo con cámara (`@zxing/browser`) o entrada manual; en
 * ambos casos dispara la búsqueda de metadatos (`MetadatosService`) que
 * pre-carga título/autor/editorial/portada/pvp — siempre editables por el
 * vendedor. El PVP llega desde el fallback de scraping que orquesta
 * `GET /api/metadatos/:isbn` (`TODO.md`, Tarea 1 — Task C), nunca desde
 * `api.letiende.co`.
 *
 * La validación del formulario es solo UX: `POST /api/libros` vuelve a
 * validar y recalcula `costo`/`utilidadCatalogo`/`bookId`/`creadoPor` en el
 * backend — este componente nunca envía ni confía en esos valores
 * (`CLAUDE.md` A08).
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
  private readonly estantesService = inject(EstantesService);
  private readonly metadatosService = inject(MetadatosService);

  protected readonly estantes = this.estantesService.estantes;
  protected readonly errorEstantes = this.estantesService.error;

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
    estanteId: ['', Validators.required],
  });

  ngOnInit(): void {
    void this.estantesService.cargarEstantes();
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
   * Consulta `MetadatosService` con el ISBN disponible (por escaneo o
   * entrada manual) y pre-carga título/autor/editorial/portada SOLO en los
   * campos que el vendedor todavía no completó a mano — nunca pisa un valor
   * ya escrito (`CLAUDE.md` A08). Si no se encuentra nada o la API falla, el
   * formulario sigue siendo 100% editable manualmente: no hay ningún
   * mensaje bloqueante, solo un aviso neutral opcional.
   */
  private async buscarYPrecargarMetadatos(isbn: string): Promise<void> {
    const isbnLimpio = isbn.trim();
    if (isbnLimpio === '') {
      return;
    }

    this.metadatosNoEncontrados.set(false);
    this.buscandoMetadatos.set(true);
    try {
      const metadatos = await this.metadatosService.obtenerMetadatos(isbnLimpio);
      const controles = this.formulario.controls;

      if (controles.titulo.value.trim() === '' && metadatos.titulo) {
        controles.titulo.setValue(metadatos.titulo);
      }
      if (controles.autor.value.trim() === '' && metadatos.autor) {
        controles.autor.setValue(metadatos.autor);
      }
      if (controles.editorial.value.trim() === '' && metadatos.editorial) {
        controles.editorial.setValue(metadatos.editorial);
      }
      if (controles.portadaUrl.value.trim() === '' && metadatos.portadaUrl) {
        controles.portadaUrl.setValue(metadatos.portadaUrl);
      }
      // Criterio de "vacío" para un campo numérico: su valor por defecto (0)
      // del formulario, no un string vacío — nunca pisa un PVP que el
      // vendedor ya haya escrito a mano.
      if (controles.pvp.value === 0 && metadatos.pvp) {
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
   * Pre-carga el candidato elegido en el formulario — mismo criterio "nunca
   * pisa lo ya escrito" que `buscarYPrecargarMetadatos` (`CLAUDE.md` A08). Si
   * el candidato trae `isbn`, además lo completa y reutiliza
   * `buscarYPrecargarMetadatos` (ya existente) para resolver el PVP vía el
   * fallback de scraping; si no trae `isbn`, el PVP queda manual, mismo
   * criterio que cualquier "no encontrado" hoy. Cierra la lista de
   * candidatos tras seleccionar uno.
   */
  protected async seleccionarCandidato(candidato: CandidatoLibro): Promise<void> {
    const controles = this.formulario.controls;

    if (controles.titulo.value.trim() === '' && candidato.titulo) {
      controles.titulo.setValue(candidato.titulo);
    }
    if (controles.autor.value.trim() === '' && candidato.autor) {
      controles.autor.setValue(candidato.autor);
    }
    if (controles.editorial.value.trim() === '' && candidato.editorial) {
      controles.editorial.setValue(candidato.editorial);
    }
    if (controles.portadaUrl.value.trim() === '' && candidato.portadaUrl) {
      controles.portadaUrl.setValue(candidato.portadaUrl);
    }

    this.candidatos.set([]);
    this.candidatosNoEncontrados.set(false);

    if (candidato.isbn) {
      controles.isbn.setValue(candidato.isbn);
      await this.buscarYPrecargarMetadatos(candidato.isbn);
    }
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
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
      estanteId: valores.estanteId,
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
   */
  private reiniciarFormulario(): void {
    this.candidatos.set([]);
    this.candidatosNoEncontrados.set(false);
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
      estanteId: '',
    });
  }
}
