import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { UsuariosService } from './core/api/usuarios.service';
import { BarraNavegacionComponent } from './shared/navegacion/barra-navegacion.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BarraNavegacionComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly authService = inject(AuthService);
  private readonly usuariosService = inject(UsuariosService);

  constructor() {
    effect(() => {
      if (this.authService.usuario()) {
        void this.usuariosService.obtenerUsuarioActual();
      }
    });
  }
}
