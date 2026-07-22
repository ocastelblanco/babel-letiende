import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { DatosNuevoUsuario, DatosUsuario, UsuariosService } from '../../core/api/usuarios.service';
import { RolUsuario, Usuario } from '../../core/models/usuario.model';

/**
 * Ruta protegida `/admin/usuarios` (`RoleGuard('administrador')`, `PRD.md`
 * §5.6, `TODO.md` Tarea 1) — CRUD de usuarios autorizados en Babel. Un único
 * formulario reactivo se reutiliza para crear y editar: `usuarioEditandoEmail`
 * distingue el modo (`null` = crear, un `email` = editando esa fila) — mismo
 * patrón que `GestionSitiosScrapingComponent`. El `email` es la clave
 * primaria suministrada por el administrador al crear, así que su control se
 * deshabilita al editar (no se puede cambiar la clave de una fila existente).
 * La autorización real la vuelve a verificar siempre `UsuariosService`/el
 * backend (`CLAUDE.md` A01) — este componente nunca decide por sí mismo si
 * el usuario puede escribir.
 *
 * Salvaguarda visual de ADR-009: el backend ya bloquea con un `400` que un
 * administrador cambie su propio rol o se elimine a sí mismo vía este
 * endpoint, pero este componente lo anticipa comparando cada fila contra
 * `authService.usuario()?.email` (identidad de Firebase del usuario
 * autenticado) — en la fila propia se deshabilita el botón "Eliminar" y,
 * al entrar en modo edición de esa fila, se deshabilita el `<select>` de rol
 * (queda fijo en `'administrador'`, que es el único rol que esa fila puede
 * tener mientras sea la propia). Así el usuario nunca depende de descubrir
 * la restricción por un mensaje de error del backend.
 */
@Component({
  selector: 'app-gestion-usuarios',
  imports: [ReactiveFormsModule],
  templateUrl: './gestion-usuarios.component.html',
})
export class GestionUsuariosComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly usuariosService = inject(UsuariosService);
  private readonly authService = inject(AuthService);

  protected readonly errorCarga = this.usuariosService.error;
  protected readonly usuarios = this.usuariosService.usuarios;

  /** Email del administrador autenticado — `null` si aún no se resolvió la sesión. Base de la salvaguarda visual ADR-009. */
  protected readonly emailPropio = computed(() => this.authService.usuario()?.email ?? null);

  protected readonly guardando = signal(false);
  protected readonly eliminandoEmail = signal<string | null>(null);
  protected readonly mensajeExito = signal<string | null>(null);
  protected readonly mensajeError = signal<string | null>(null);

  /** Controla si el formulario de creación/edición está desplegado — oculto por defecto. */
  protected readonly formularioVisible = signal(false);

  /** `null` mientras se crea un usuario nuevo; el `email` de la fila mientras se edita. */
  protected readonly usuarioEditandoEmail = signal<string | null>(null);

  /** `true` cuando la fila en edición es la del propio administrador autenticado — deshabilita el cambio de rol (ADR-009). */
  protected readonly editandoPropiaFila = computed(() => {
    const email = this.usuarioEditandoEmail();
    return email !== null && email === this.emailPropio();
  });

  protected readonly formulario = this.fb.nonNullable.group({
    email: ['', Validators.required],
    nombre: ['', Validators.required],
    rol: ['vendedor' as RolUsuario, Validators.required],
  });

  ngOnInit(): void {
    void this.usuariosService.cargarUsuarios();
  }

  /** `true` si el `email` de la fila coincide con el del administrador autenticado. */
  protected esPropiaFila(usuario: Usuario): boolean {
    return usuario.email === this.emailPropio();
  }

  /** Limpia cualquier estado de edición previo y abre el formulario vacío en modo "crear". */
  protected agregar(): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.usuarioEditandoEmail.set(null);
    this.formulario.reset({ email: '', nombre: '', rol: 'vendedor' });
    this.formulario.controls.email.enable();
    this.formulario.controls.rol.enable();
    this.formularioVisible.set(true);
  }

  /**
   * Precarga el formulario con los datos de la fila, deshabilita `email`
   * (clave primaria, no editable) y entra en modo edición. Si la fila es la
   * del propio administrador autenticado, además deshabilita `rol`
   * (salvaguarda visual ADR-009: no puede degradar su propio rol).
   */
  protected editar(usuario: Usuario): void {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);
    this.usuarioEditandoEmail.set(usuario.email);
    this.formulario.setValue({ email: usuario.email, nombre: usuario.nombre, rol: usuario.rol });
    this.formulario.controls.email.disable();
    if (this.esPropiaFila(usuario)) {
      this.formulario.controls.rol.disable();
    } else {
      this.formulario.controls.rol.enable();
    }
    this.formularioVisible.set(true);
  }

  /** Sale del modo edición, limpia el formulario, vuelve a habilitar los controles y oculta el formulario, sin guardar cambios. */
  protected cancelarEdicion(): void {
    this.usuarioEditandoEmail.set(null);
    this.formulario.reset({ email: '', nombre: '', rol: 'vendedor' });
    this.formulario.controls.email.enable();
    this.formulario.controls.rol.enable();
    this.formularioVisible.set(false);
  }

  protected async guardar(): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const valores = this.formulario.getRawValue();
    const emailEditando = this.usuarioEditandoEmail();

    this.guardando.set(true);
    try {
      const resultado = emailEditando
        ? await this.usuariosService.actualizarUsuario(emailEditando, {
            nombre: valores.nombre,
            rol: valores.rol,
          } satisfies DatosUsuario)
        : await this.usuariosService.crearUsuario({
            email: valores.email,
            nombre: valores.nombre,
            rol: valores.rol,
          } satisfies DatosNuevoUsuario);

      if (resultado.exito) {
        this.mensajeExito.set(emailEditando ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.');
        this.usuarioEditandoEmail.set(null);
        this.formulario.reset({ email: '', nombre: '', rol: 'vendedor' });
        this.formulario.controls.email.enable();
        this.formulario.controls.rol.enable();
        this.formularioVisible.set(false);
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  protected async eliminar(usuario: Usuario): Promise<void> {
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    if (!confirm(`¿Eliminar al usuario "${usuario.nombre}" (${usuario.email})?`)) {
      return;
    }

    this.eliminandoEmail.set(usuario.email);
    try {
      const resultado = await this.usuariosService.eliminarUsuario(usuario.email);
      if (resultado.exito) {
        this.mensajeExito.set('Usuario eliminado correctamente.');
        if (this.usuarioEditandoEmail() === usuario.email) {
          this.cancelarEdicion();
        }
      } else {
        this.mensajeError.set(resultado.error);
      }
    } finally {
      this.eliminandoEmail.set(null);
    }
  }
}
