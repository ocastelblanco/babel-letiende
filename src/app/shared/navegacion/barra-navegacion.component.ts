import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { UsuariosService } from '../../core/api/usuarios.service';
import { AuthService } from '../../core/auth/auth.service';

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

  protected async cerrarSesion(): Promise<void> {
    this.cerrarMenu();
    await this.authService.cerrarSesion();
    await this.router.navigateByUrl('/');
  }
}
