import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UsuariosService } from '../../core/api/usuarios.service';

/**
 * Pantalla de ingreso con Google (tech-specs.md §4.2, ruta /login).
 * El manejo de errores nunca expone el mensaje crudo del SDK de Firebase ni
 * detalles internos al usuario (CLAUDE.md, A05) — solo un mensaje genérico.
 * El regreso al catálogo público ahora se hace desde el logo de
 * `BarraNavegacionComponent`, siempre visible en el header (incluida esta
 * pantalla) — ya no hace falta un vínculo propio aquí.
 *
 * Tras el login exitoso en Firebase se valida además contra `babel-usuarios`
 * (`GET /api/usuarios/me`, CLAUDE.md A01): el proyecto Firebase es compartido
 * con Comandante/Ágora, así que un correo puede autenticarse aquí sin tener
 * ningún `Usuario` en Babel. Si ocurre, se cierra la sesión de inmediato (no
 * queda "medio autenticado") y se explica el motivo — antes quedaba
 * autenticado sin permisos y `RoleGuard` lo devolvía a `/` en silencio al
 * entrar a `/catalogar`, sin ninguna pista de por qué.
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly usuariosService = inject(UsuariosService);
  private readonly router = inject(Router);

  protected readonly cargando = signal(false);
  protected readonly mensajeError = signal<string | null>(null);

  protected async ingresarConGoogle(): Promise<void> {
    this.cargando.set(true);
    this.mensajeError.set(null);

    try {
      await this.authService.iniciarSesionConGoogle();

      const usuario = await this.usuariosService.obtenerUsuarioActual();
      if (!usuario) {
        await this.authService.cerrarSesion();
        this.mensajeError.set(
          'Esta cuenta pertenece a otro proyecto de Le Tiende (como Comandante o Ágora), pero no tiene acceso a Babel. Si crees que es un error, contacta a un administrador de Babel.',
        );
        return;
      }

      await this.router.navigateByUrl('/');
    } catch {
      this.mensajeError.set('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }
}
