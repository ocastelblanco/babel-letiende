import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CargaConocimientoService } from '../../core/api/carga-conocimiento.service';
import { ConteoCobertura, ResumenCargaConocimiento } from '../../core/models/carga-conocimiento.model';

const INTERVALO_POLLING_MS = 3000;

interface FilaCobertura {
  clave: string;
  total: number;
  utiles: number;
}

function aFilas(mapa: Record<string, ConteoCobertura>): FilaCobertura[] {
  return Object.entries(mapa)
    .map(([clave, conteo]) => ({ clave, ...conteo }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Ruta protegida `/admin/carga-conocimiento` (`RoleGuard('administrador')`, T-0013): dispara
 * la carga retroactiva de sinopsis y datos del asistente y muestra su avance y el reporte de
 * cobertura por idioma y por fuente. Solo cifras: la sinopsis nunca se muestra aquí. Todo el
 * trabajo ocurre en el backend; este componente solo llama `POST` y hace polling del `GET`.
 * Mismo patrón que `ValidarLibrosComponent`: el `409` de "ya hay una carga" se trata como
 * retomar el polling, no como un error.
 */
@Component({
  selector: 'app-carga-conocimiento',
  imports: [],
  templateUrl: './carga-conocimiento.component.html',
})
export class CargaConocimientoComponent implements OnDestroy {
  private readonly servicio = inject(CargaConocimientoService);

  protected readonly resumen = signal<ResumenCargaConocimiento | null>(null);
  protected readonly iniciando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly enProgreso = computed(() => this.resumen()?.estado === 'en_progreso');
  protected readonly porcentaje = computed(() => {
    const actual = this.resumen();
    return !actual || actual.totalLibros === 0 ? 0 : Math.round((actual.librosRevisados / actual.totalLibros) * 100);
  });
  protected readonly filasIdioma = computed(() => aFilas(this.resumen()?.porIdioma ?? {}));
  protected readonly filasFuente = computed(() => aFilas(this.resumen()?.porFuente ?? {}));

  private intervaloId: ReturnType<typeof setInterval> | undefined;

  ngOnDestroy(): void {
    this.detenerPolling();
  }

  protected async iniciar(): Promise<void> {
    this.error.set(null);
    this.resumen.set(null);
    this.iniciando.set(true);
    try {
      const resultado = await this.servicio.iniciar();
      if (resultado.iniciada) {
        this.iniciarPolling(resultado.cargaId);
      } else if (resultado.cargaIdEnCurso) {
        this.iniciarPolling(resultado.cargaIdEnCurso);
      } else {
        this.error.set(resultado.error);
      }
    } finally {
      this.iniciando.set(false);
    }
  }

  private iniciarPolling(cargaId: string): void {
    this.detenerPolling();
    void this.consultarUnaVez(cargaId);
    this.intervaloId = setInterval(() => void this.consultarUnaVez(cargaId), INTERVALO_POLLING_MS);
  }

  private async consultarUnaVez(cargaId: string): Promise<void> {
    const actual = await this.servicio.consultar(cargaId);
    if (!actual) {
      this.detenerPolling();
      this.resumen.set(null);
      this.error.set('Se perdió la conexión con la carga en curso. Puedes intentar de nuevo.');
      return;
    }
    this.resumen.set(actual);
    if (actual.estado !== 'en_progreso') {
      this.detenerPolling();
    }
  }

  private detenerPolling(): void {
    if (this.intervaloId !== undefined) {
      clearInterval(this.intervaloId);
      this.intervaloId = undefined;
    }
  }
}
