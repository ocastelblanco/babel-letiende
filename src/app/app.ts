import { Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { UsuariosService } from './core/api/usuarios.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly authService = inject(AuthService);
  private readonly usuariosService = inject(UsuariosService);
  private readonly router = inject(Router);

  /**
   * Se apoya en `authService.usuario()` (no solo en el último valor cacheado
   * de `UsuariosService`) para que el enlace desaparezca de inmediato al
   * cerrar sesión, sin depender de limpiar el Signal de `UsuariosService`.
   */
  protected readonly esAdministrador = computed(
    () => this.authService.usuario() !== null && this.usuariosService.usuarioActual()?.rol === 'administrador',
  );

  constructor() {
    effect(() => {
      if (this.authService.usuario()) {
        void this.usuariosService.obtenerUsuarioActual();
      }
    });
  }

  protected async cerrarSesion(): Promise<void> {
    await this.authService.cerrarSesion();
    await this.router.navigateByUrl('/');
  }
}
