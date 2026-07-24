import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Pantalla de ingreso con Google (tech-specs.md §4.2, ruta /login).
 * El manejo de errores nunca expone el mensaje crudo del SDK de Firebase ni
 * detalles internos al usuario (CLAUDE.md, A05) — solo un mensaje genérico.
 * Incluye un vínculo de regreso al catálogo público (`TODO.md`, fixes
 * rápidos del catálogo público) — para un cliente sin cuenta que haga clic
 * en "Ingresar" por error.
 */
@Component({
  selector: 'app-login',
  imports: [RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly cargando = signal(false);
  protected readonly mensajeError = signal<string | null>(null);

  protected async ingresarConGoogle(): Promise<void> {
    this.cargando.set(true);
    this.mensajeError.set(null);

    try {
      await this.authService.iniciarSesionConGoogle();
      await this.router.navigateByUrl('/');
    } catch {
      this.mensajeError.set('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }
}
