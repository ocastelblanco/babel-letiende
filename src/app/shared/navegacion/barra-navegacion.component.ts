import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { UsuariosService } from '../../core/api/usuarios.service';
import { AuthService } from '../../core/auth/auth.service';
import { EmbebidoService } from '../../core/embebido/embebido.service';

/**
 * Barra de navegación superior de toda la app — **siempre visible**, con o
 * sin sesión, para ofrecer siempre una forma de llegar a `/login`. Reproduce
 * el patrón ya validado en el proyecto hermano Ágora
 * (`barra-navegacion.component.ts`), simplificado a los 2 destinos que Babel
 * necesita ("Catalogar" y "Administración"): a diferencia de Ágora, aquí no
 * existe el sistema de `grupos`/`rolMinimo`, solo enlaces fijos.
 *
 * Sin `@Input()`: todo el estado sale de `AuthService`/`UsuariosService`
 * inyectados directamente (mismo patrón que tenía `App` antes de este
 * rediseño). El drawer móvil (`< 768px`) es `signal(false)` + `@if` +
 * Tailwind, mismo patrón que `menuAbierto` de Ágora.
 */
@Component({
  selector: 'app-barra-navegacion',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './barra-navegacion.component.html',
})
export class BarraNavegacionComponent {
  private readonly authService = inject(AuthService);
  private readonly usuariosService = inject(UsuariosService);
  private readonly router = inject(Router);

  /**
   * `true` cuando la app se sirve embebida a través del proxy de
   * letiende.co (Host `letiende.co`/`staging.letiende.co`) — en ese caso
   * el `<header>` completo se reemplaza por la barra común del contenedor
   * (solo el estado sin sesión; el panel autenticado no se toca).
   */
  protected readonly embebido = inject(EmbebidoService).embebido;

  protected readonly usuario = this.authService.usuario;

  /**
   * Se apoya en `authService.usuario()` (no solo en el último valor cacheado
   * de `UsuariosService`) para que el enlace desaparezca de inmediato al
   * cerrar sesión, sin depender de limpiar el Signal de `UsuariosService`.
   */
  protected readonly esAdministrador = computed(
    () => this.usuario() !== null && this.usuariosService.usuarioActual()?.rol === 'administrador',
  );

  /** Controla el drawer móvil (`< 768px`) — oculto por defecto. */
  protected readonly menuAbierto = signal(false);

  /** Controla el panel móvil de la barra embebida (independiente del drawer del panel autenticado). */
  protected readonly menuEmbebidoAbierto = signal(false);
  private readonly botonMenuEmbebido = viewChild<ElementRef<HTMLButtonElement>>('botonMenuEmbebido');
  private readonly botonCerrarEmbebido = viewChild<ElementRef<HTMLButtonElement>>('botonCerrarEmbebido');

  constructor() {
    // Cuando el panel móvil embebido se abre, el foco pasa a su botón de
    // cierre — mismo patrón de accesibilidad que `BarraNavegacion` del
    // contenedor letiende.co.
    effect(() => {
      if (this.menuEmbebidoAbierto()) {
        this.botonCerrarEmbebido()?.nativeElement.focus();
      }
    });
  }

  /**
   * Ruta actual, vía `Router.events` (`NavigationEnd`) convertido con
   * `toSignal` — Angular no expone la ruta activa como signal nativo
   * todavía. Único consumo: ocultar el botón "Ingresar" en `/login`, donde
   * se confunde con "Ingresar con Google".
   */
  private readonly rutaActual = toSignal(
    this.router.events.pipe(
      filter((evento) => evento instanceof NavigationEnd),
      map((evento) => evento.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** `true` en `/login` — el botón "Ingresar" del header solo se oculta ahí. */
  protected readonly enLogin = computed(() => this.rutaActual() === '/login');

  /** Inicial del nombre (o correo) del usuario actual, para el avatar de respaldo sin foto. */
  protected readonly inicial = computed(() => {
    const usuario = this.usuario();
    const fuente = usuario?.displayName ?? usuario?.email ?? '?';
    return fuente.charAt(0).toUpperCase();
  });

  protected cerrarMenu(): void {
    this.menuAbierto.set(false);
  }

  protected alternarMenu(): void {
    this.menuAbierto.set(!this.menuAbierto());
  }

  protected alternarMenuEmbebido(): void {
    this.menuEmbebidoAbierto.update((abierto) => !abierto);
  }

  protected cerrarMenuEmbebido(): void {
    if (!this.menuEmbebidoAbierto()) return;
    this.menuEmbebidoAbierto.set(false);
    this.botonMenuEmbebido()?.nativeElement.focus();
  }

  protected async cerrarSesion(): Promise<void> {
    this.cerrarMenu();
    await this.authService.cerrarSesion();
    await this.router.navigateByUrl('/');
  }
}
