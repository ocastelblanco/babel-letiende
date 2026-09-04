import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { LibrosService } from '../../core/api/libros.service';
import { UbicacionFisicaService } from '../../core/api/ubicacion-fisica.service';
import { ValidacionesLibrosService } from '../../core/api/validaciones-libros.service';
import { ResumenValidacionLibros } from '../../core/models/validacion-libros.model';

/** Cadencia de polling del progreso — mismo valor documentado en `docs/plan-validar-libros-async.md` §7. */
const INTERVALO_POLLING_MS = 3000;

/**
 * Ruta protegida `/admin/validar-libros` (`RoleGuard('administrador')`,
 * ADR-012, `docs/plan-validar-libros-async.md` §7) — dispara y sigue el
 * progreso del proceso asíncrono "Validar libros" (PVP + portada, por
 * mueble). Este componente NUNCA hace scraping ni toca `babel-libros`
 * directamente: solo llama `POST /api/validaciones-libros` para arrancar una
 * corrida y hace polling de `GET /api/validaciones-libros/:validacionId`
 * cada `INTERVALO_POLLING_MS` — todo el trabajo real ocurre en
 * `validarLibrosWorker` (backend).
 *
 * `ValidacionesLibrosService.ultimoValidacionId` (en memoria, singleton de
 * `providedIn: 'root'`) permite retomar el polling si el administrador
 * navega fuera de esta ruta y vuelve dentro de la misma sesión de la SPA.
 * Tras un recargo real de página no hay forma de saberlo de antemano (no
 * existe un endpoint "dame la última corrida", decisión ya tomada en el
 * diseño) — el respaldo es el `409` de `iniciarValidacion()`: si ya hay una
 * corrida activa en el backend, un segundo clic en "Iniciar validación" la
 * retoma automáticamente en vez de bloquear al administrador con un error.
 */
@Component({
  selector: 'app-validar-libros',
  imports: [],
  templateUrl: './validar-libros.component.html',
})
export class ValidarLibrosComponent implements OnInit, OnDestroy {
  private readonly validacionesLibrosService = inject(ValidacionesLibrosService);
  private readonly ubicacionFisicaService = inject(UbicacionFisicaService);
  private readonly librosService = inject(LibrosService);

  protected readonly resumen = signal<ResumenValidacionLibros | null>(null);
  protected readonly iniciando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly enProgreso = computed(() => this.resumen()?.estado === 'en_progreso');
  protected readonly terminada = computed(() => {
    const estado = this.resumen()?.estado;
    return estado === 'completado' || estado === 'error';
  });
  protected readonly porcentaje = computed(() => {
    const resumenActual = this.resumen();
    if (!resumenActual || resumenActual.totalLibros === 0) {
      return 0;
    }
    return Math.round((resumenActual.librosRevisados / resumenActual.totalLibros) * 100);
  });

  /** Validación por lotes (parcelizar por Mueble): mismos Signals expuestos por `UbicacionFisicaService`/`LibrosService`, ya cargados en `ngOnInit`. */
  protected readonly espacios = this.ubicacionFisicaService.espacios;
  protected readonly espacioSeleccionado = signal('');
  protected readonly mueblesSeleccionados = signal<Set<string>>(new Set());

  /** Muebles del Espacio elegido — vacío si no hay Espacio elegido, mismo patrón que `catalogo-publico.component.ts`. */
  protected readonly mueblesFiltrados = computed(() => {
    const espacioId = this.espacioSeleccionado();
    if (espacioId === '') {
      return [];
    }
    return this.ubicacionFisicaService.muebles().filter((mueble) => mueble.espacioId === espacioId);
  });

  /** `ubicacionId → muebleId`, para resolver a qué mueble pertenece cada libro del índice (mismo patrón que `catalogo-publico.component.ts`). */
  private readonly muebleDeUbicacion = computed(() => {
    return new Map(this.ubicacionFisicaService.ubicaciones().map((ubicacion) => [ubicacion.ubicacionId, ubicacion.muebleId]));
  });

  /** Cantidad de libros (del índice liviano de `LibrosService`) que resuelven a cada mueble. */
  protected readonly conteoPorMueble = computed(() => {
    const muebleDeUbicacion = this.muebleDeUbicacion();
    const conteo = new Map<string, number>();
    for (const libro of this.librosService.indice()) {
      const muebleId = muebleDeUbicacion.get(libro.ubicacionId);
      if (muebleId) {
        conteo.set(muebleId, (conteo.get(muebleId) ?? 0) + 1);
      }
    }
    return conteo;
  });

  /** `true` si TODOS los muebles del Espacio actual ya están marcados — refleja el estado del atajo "Seleccionar todo el Espacio". */
  protected readonly todoElEspacioSeleccionado = computed(() => {
    const muebles = this.mueblesFiltrados();
    if (muebles.length === 0) {
      return false;
    }
    const seleccionados = this.mueblesSeleccionados();
    return muebles.every((mueble) => seleccionados.has(mueble.muebleId));
  });

  /** Suma de `conteoPorMueble` para los muebles marcados — cuántos libros se van a validar si hay selección. */
  protected readonly totalLibrosSeleccionados = computed(() => {
    const conteo = this.conteoPorMueble();
    let total = 0;
    for (const muebleId of this.mueblesSeleccionados()) {
      total += conteo.get(muebleId) ?? 0;
    }
    return total;
  });

  private intervaloId: ReturnType<typeof setInterval> | undefined;

  ngOnInit(): void {
    void this.ubicacionFisicaService.cargarEspacios();
    void this.ubicacionFisicaService.cargarMuebles();
    void this.ubicacionFisicaService.cargarUbicaciones();
    void this.librosService.cargarIndice();

    const idPrevio = this.validacionesLibrosService.ultimoValidacionId();
    if (idPrevio) {
      void this.retomar(idPrevio);
    }
  }

  ngOnDestroy(): void {
    this.detenerPolling();
  }

  private async retomar(validacionId: string): Promise<void> {
    const resumenActual = await this.validacionesLibrosService.consultarValidacion(validacionId);
    if (!resumenActual) {
      return;
    }
    this.resumen.set(resumenActual);
    if (resumenActual.estado === 'en_progreso') {
      this.iniciarPolling(validacionId);
    }
  }

  protected async iniciar(): Promise<void> {
    this.error.set(null);
    this.resumen.set(null);
    this.iniciando.set(true);
    try {
      const resultado = await this.validacionesLibrosService.iniciarValidacion(Array.from(this.mueblesSeleccionados()));
      if (resultado.iniciada) {
        this.iniciarPolling(resultado.validacionId);
      } else if (resultado.validacionIdEnCurso) {
        await this.retomar(resultado.validacionIdEnCurso);
      } else {
        this.error.set(resultado.error);
      }
    } finally {
      this.iniciando.set(false);
    }
  }

  /** Al cambiar de Espacio, se limpia la selección de muebles — un mueble marcado de otro Espacio ya no aplica. */
  protected seleccionarEspacio(espacioId: string): void {
    this.espacioSeleccionado.set(espacioId);
    this.mueblesSeleccionados.set(new Set());
  }

  /** Agrega/quita un mueble del `Set` de seleccionados — inmutable, Angular Signals no detecta mutación in-place. */
  protected alternarMueble(muebleId: string): void {
    const actuales = new Set(this.mueblesSeleccionados());
    if (actuales.has(muebleId)) {
      actuales.delete(muebleId);
    } else {
      actuales.add(muebleId);
    }
    this.mueblesSeleccionados.set(actuales);
  }

  /** "Seleccionar todo el Espacio": si ya están todos marcados, los deselecciona; si no, los selecciona todos. */
  protected alternarTodoElEspacio(): void {
    if (this.todoElEspacioSeleccionado()) {
      const actuales = new Set(this.mueblesSeleccionados());
      for (const mueble of this.mueblesFiltrados()) {
        actuales.delete(mueble.muebleId);
      }
      this.mueblesSeleccionados.set(actuales);
    } else {
      const actuales = new Set(this.mueblesSeleccionados());
      for (const mueble of this.mueblesFiltrados()) {
        actuales.add(mueble.muebleId);
      }
      this.mueblesSeleccionados.set(actuales);
    }
  }

  private iniciarPolling(validacionId: string): void {
    this.detenerPolling();
    void this.consultarUnaVez(validacionId);
    this.intervaloId = setInterval(() => void this.consultarUnaVez(validacionId), INTERVALO_POLLING_MS);
  }

  private async consultarUnaVez(validacionId: string): Promise<void> {
    const resumenActual = await this.validacionesLibrosService.consultarValidacion(validacionId);
    if (!resumenActual) {
      // Corrida ya no encontrada o error de red puntual — se detiene el
      // polling en vez de seguir intentando indefinidamente. `resumen` se
      // limpia (no se deja el último "en_progreso" conocido) para que
      // `enProgreso()` vuelva a `false` y el botón "Iniciar validación" se
      // reactive — si no, el administrador quedaría bloqueado sin poder
      // reintentar aunque el polling ya se haya detenido.
      this.detenerPolling();
      this.resumen.set(null);
      this.error.set('Se perdió la conexión con la validación en curso. Puedes intentar de nuevo.');
      return;
    }
    this.resumen.set(resumenActual);
    if (resumenActual.estado !== 'en_progreso') {
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
