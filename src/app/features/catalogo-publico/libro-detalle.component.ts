import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import { LibrosService } from '../../core/api/libros.service';
import { VentaService } from '../../core/api/venta.service';
import type { EjemplarConUbicacion, LibroConEjemplares } from '../../core/models/libro.model';
import { FormaDePago } from '../../core/models/venta.model';
import { PvpPipe } from '../../shared/pipes/pvp.pipe';

/** Mismas 5 formas de pago aceptadas por el backend (`server/api/handlers/ventas.ts`, `FORMAS_DE_PAGO`) — igual que `ReportesVentasComponent`. */
const FORMAS_DE_PAGO: readonly FormaDePago[] = ['efectivo', 'tarjeta', 'transferencia', 'nequi', 'daviplata'];

/**
 * Ficha pública de un libro puntual (`tech-specs.md`, módulo
 * `catalogo-publico/`; `TODO.md`, ficha de libro), ruta `/libro/:bookId`,
 * sin guard — pública igual que `CatalogoPublicoComponent`. `RenderMode`
 * la resuelve el catch-all `**` de `app.routes.server.ts` (`RenderMode.Server`,
 * mismo criterio ya aplicado a `''`: sin guard, se puede renderizar en el
 * servidor para SEO).
 *
 * Pide el libro directo a `GET /api/libros/:bookId` (no reutiliza el
 * `libros()` de `LibrosService` como hace `CambiarUbicacionComponent`)
 * porque esta puede ser la primera petición de la sesión — un visitante
 * puede llegar por un enlace directo o un buscador sin haber visto antes el
 * listado en `/`.
 *
 * Primera UI real de `POST /api/ventas` (`TODO.md` Tarea 2): el botón
 * "Vender" y su diálogo son visibles solo con sesión activa y rol
 * `vendedor`/`administrador` — mismo criterio de guard visual que
 * `BarraNavegacionComponent.esAdministrador` (se apoya primero en
 * `authService.usuario()` para que desaparezca de inmediato al cerrar
 * sesión, sin depender del último valor cacheado de `UsuariosService`). La
 * autorización real siempre la vuelve a verificar el backend (`CLAUDE.md`
 * A01) — este componente nunca decide por sí mismo si el usuario puede
 * vender.
 *
 * Apilamiento por ISBN (Tarea 4 del lote de duplicados,
 * `docs/plan-duplicados-catalogacion.md` §7): `libro.ejemplares` (aditivo
 * en `GET /api/libros/:bookId`, ya resuelto y filtrado a solo disponibles
 * por el backend) puede traer varios `bookId` — libros catalogados por
 * separado que comparten ISBN. Un panel "Ubicación en la librería" por
 * ejemplar, cada uno con su propio PVP y su propio botón VENDER — el
 * diálogo de venta actúa siempre sobre el `bookId` DEL PANEL que lo abrió
 * (`ejemplarSeleccionadoVenta`), nunca sobre `libro().bookId` (que solo
 * describe el ejemplar puntual que resolvió la URL, no un agregado). Un
 * arreglo `ejemplares` vacío significa agotado en TODAS las ubicaciones
 * (S6) — la ficha se sigue mostrando (un enlace directo debe funcionar
 * aunque esté agotado), con una nota y sin ningún botón VENDER. La URL
 * sigue siendo `/libro/:bookId` sin cambios (S7).
 */
@Component({
  selector: 'app-libro-detalle',
  imports: [PvpPipe, ReactiveFormsModule],
  templateUrl: './libro-detalle.component.html',
})
export class LibroDetalleComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly librosService = inject(LibrosService);
  private readonly authService = inject(AuthService);
  private readonly usuariosService = inject(UsuariosService);
  private readonly ventaService = inject(VentaService);
  private readonly fb = inject(FormBuilder);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  private readonly bookId = this.route.snapshot.paramMap.get('bookId') ?? '';

  protected readonly libro = signal<LibroConEjemplares | null>(null);
  protected readonly cargando = signal(true);
  /** `true` cuando el libro no existe o la petición falló — mismo mensaje para ambos casos ante el visitante (`LibrosService.obtenerDetalle` nunca lanza). */
  protected readonly noEncontrado = signal(false);

  protected readonly formasDePago = FORMAS_DE_PAGO;

  /** `true` si `ejemplares` llegó vacío — agotado en TODAS las ubicaciones (S6), no un error de carga. */
  protected readonly agotadoEnTodasLasUbicaciones = computed(() => this.libro()?.ejemplares.length === 0);

  /**
   * PVP para la cabecera (D4): el valor único si todos los ejemplares
   * disponibles cuestan lo mismo, o el rango mínimo/máximo si difieren —
   * ejemplares catalogados por separado pueden llevar precios distintos. Si
   * no hay ningún ejemplar disponible, cae al PVP del propio libro pedido
   * (sigue siendo un dato real y útil de referencia, aunque esté agotado).
   */
  protected readonly rangoPvp = computed<{ minimo: number; maximo: number } | null>(() => {
    const libro = this.libro();
    if (!libro) {
      return null;
    }
    if (libro.ejemplares.length === 0) {
      return { minimo: libro.pvp, maximo: libro.pvp };
    }
    const precios = libro.ejemplares.map((ejemplar) => ejemplar.pvp);
    return { minimo: Math.min(...precios), maximo: Math.max(...precios) };
  });

  /**
   * `true` con sesión activa y rol `vendedor`/`administrador` en
   * `babel-usuarios`. Ver nota de clase sobre el criterio de guard visual.
   */
  protected readonly puedeVender = computed(() => {
    const rol = this.usuariosService.usuarioActual()?.rol;
    return this.authService.usuario() !== null && (rol === 'vendedor' || rol === 'administrador');
  });

  protected readonly dialogoVentaVisible = signal(false);
  /** El ejemplar (panel) sobre el que actúa el diálogo de venta abierto — `null` mientras el diálogo está cerrado. `confirmarVenta` usa SIEMPRE `.bookId` de acá, nunca `libro().bookId` (Tarea 4, apilamiento). */
  protected readonly ejemplarSeleccionadoVenta = signal<EjemplarConUbicacion | null>(null);
  protected readonly vendiendo = signal(false);
  protected readonly mensajeExitoVenta = signal<string | null>(null);
  protected readonly mensajeErrorVenta = signal<string | null>(null);

  protected readonly formularioVenta = this.fb.nonNullable.group({
    cantidad: [1, [Validators.required, Validators.min(1)]],
    porcentajeDescuentoVenta: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    formaDePago: ['' as FormaDePago | '', Validators.required],
  });

  constructor() {
    // Mismo patrón que `App`: resolver el rol solo cuando hay sesión, sin bloquear el renderizado de la ficha (pública) mientras tanto.
    effect(() => {
      if (this.authService.usuario()) {
        void this.usuariosService.obtenerUsuarioActual();
      }
    });
  }

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

  /**
   * Vuelve a pedir el libro tras registrar una venta, para reflejar la
   * `cantidadDisponible` real. A diferencia de `cargarLibro()`, no toca
   * `cargando`/`noEncontrado` — la ficha ya está desplegada y no debe
   * ocultarse (junto con el mensaje de éxito) durante el refresco.
   */
  private async refrescarLibro(): Promise<void> {
    const libro = await this.librosService.obtenerDetalle(this.bookId);
    if (libro) {
      this.libro.set(libro);
    }
  }

  /**
   * Abre el diálogo de venta para UN ejemplar puntual (panel de ubicación,
   * Tarea 4) con los valores por defecto y el máximo permitido según la
   * disponibilidad de ESE ejemplar — nunca la del `libro()` de nivel
   * superior, que puede ser un `bookId` distinto o estar agotado mientras
   * otro ejemplar del mismo ISBN sigue disponible.
   */
  protected abrirDialogoVenta(ejemplar: EjemplarConUbicacion): void {
    this.ejemplarSeleccionadoVenta.set(ejemplar);
    this.mensajeExitoVenta.set(null);
    this.mensajeErrorVenta.set(null);
    this.formularioVenta.reset({ cantidad: 1, porcentajeDescuentoVenta: 0, formaDePago: '' });
    this.formularioVenta.controls.cantidad.setValidators([
      Validators.required,
      Validators.min(1),
      Validators.max(ejemplar.cantidadDisponible),
    ]);
    this.formularioVenta.controls.cantidad.updateValueAndValidity();
    this.dialogoVentaVisible.set(true);
  }

  /** Cierra el diálogo sin guardar cambios. */
  protected cerrarDialogoVenta(): void {
    this.dialogoVentaVisible.set(false);
    this.ejemplarSeleccionadoVenta.set(null);
  }

  protected async confirmarVenta(): Promise<void> {
    if (this.formularioVenta.invalid) {
      this.formularioVenta.markAllAsTouched();
      return;
    }
    const ejemplar = this.ejemplarSeleccionadoVenta();
    if (!ejemplar) {
      return;
    }

    const valores = this.formularioVenta.getRawValue();
    this.vendiendo.set(true);
    this.mensajeErrorVenta.set(null);
    try {
      const resultado = await this.ventaService.registrarVenta({
        bookId: ejemplar.bookId,
        cantidad: valores.cantidad,
        porcentajeDescuentoVenta: valores.porcentajeDescuentoVenta,
        formaDePago: valores.formaDePago as FormaDePago,
      });

      if (resultado.exito) {
        this.dialogoVentaVisible.set(false);
        this.ejemplarSeleccionadoVenta.set(null);
        this.mensajeExitoVenta.set('Venta registrada correctamente.');
        await this.refrescarLibro();
      } else {
        this.mensajeErrorVenta.set(resultado.error);
      }
    } finally {
      this.vendiendo.set(false);
    }
  }
}
