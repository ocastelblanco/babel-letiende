import { Component, ElementRef, OnDestroy, output, signal, viewChild } from '@angular/core';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { IScannerControls } from '@zxing/browser';

/**
 * Escáner de código de barras (EAN-13/ISBN-13) reutilizable con
 * `@zxing/browser` — extraído de `CatalogarLibroComponent` (donde vivía
 * fuertemente acoplado a la pre-carga de metadatos y la detección de
 * duplicados) para reutilizarlo también en el catálogo público
 * (`CatalogoPublicoComponent`), sin duplicar la lógica de cámara por tercera
 * vez.
 *
 * Encapsula TODO el ciclo de vida de la cámara: botón "Escanear"/"Detener",
 * `<video>` propio y manejo de error, con los mismos hints (`EAN_13`) y la
 * misma constraint (`facingMode: 'environment', aspectRatio: { ideal: 3 }`)
 * que el flujo original. A diferencia del original, este componente NO
 * dispara ninguna búsqueda de metadatos — solo emite el ISBN detectado
 * (`codigoDetectado`) y detiene el escaneo; el padre decide qué hacer con
 * ese código.
 */
@Component({
  selector: 'app-escaner-codigo-barras',
  template: `
    <div>
      <button
        type="button"
        (click)="escaneando() ? detenerEscaneo() : iniciarEscaneo()"
        class="shrink-0 rounded-xl border border-primary/20 px-3 py-2 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
      >
        {{ escaneando() ? 'Detener' : 'Escanear ISBN' }}
      </button>

      <video
        #videoEscaner
        autoplay
        muted
        playsinline
        class="mt-2 aspect-[2/1] w-full rounded-xl object-cover"
        [class.hidden]="!escaneando()"
      ></video>

      @if (errorEscaneo()) {
        <p class="mt-1 text-xs text-danger">{{ errorEscaneo() }}</p>
      }
    </div>
  `,
})
export class EscanerCodigoBarrasComponent implements OnDestroy {
  private readonly videoEscaner = viewChild<ElementRef<HTMLVideoElement>>('videoEscaner');

  protected readonly escaneando = signal(false);
  protected readonly errorEscaneo = signal<string | null>(null);
  private controlesEscaner: IScannerControls | null = null;

  /** ISBN (EAN-13) detectado por la cámara — el escaneo ya se detuvo cuando se emite. */
  readonly codigoDetectado = output<string>();

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
        // (`aspect-[2/1] object-cover` en la plantilla) es lo único que
        // garantiza el resultado visual final.
        { video: { facingMode: 'environment', aspectRatio: { ideal: 3 } } },
        video,
        (resultado) => {
          if (resultado) {
            const codigo = resultado.getText();
            this.detenerEscaneo();
            this.codigoDetectado.emit(codigo);
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
}
