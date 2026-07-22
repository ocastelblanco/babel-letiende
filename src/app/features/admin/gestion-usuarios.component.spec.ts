import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import type { Usuario } from '../../core/models/usuario.model';
import { GestionUsuariosComponent } from './gestion-usuarios.component';

const admin: Usuario = {
  email: 'admin@letiende.co',
  nombre: 'Admin',
  fotoUrl: null,
  rol: 'administrador',
  creadoEn: '2026-07-19T00:00:00.000Z',
};

const vendedor: Usuario = {
  email: 'vendedor@letiende.co',
  nombre: 'Vendedor',
  fotoUrl: null,
  rol: 'vendedor',
  creadoEn: '2026-07-19T00:00:00.000Z',
};

function configurarPrueba(
  opciones: { usuarios?: Usuario[]; error?: boolean; emailAutenticado?: string | null } = {},
) {
  const cargarUsuariosMock = vi.fn().mockResolvedValue(undefined);
  const crearUsuarioMock = vi.fn().mockResolvedValue({ exito: true });
  const actualizarUsuarioMock = vi.fn().mockResolvedValue({ exito: true });
  const eliminarUsuarioMock = vi.fn().mockResolvedValue({ exito: true });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: UsuariosService,
        useValue: {
          usuarios: signal(opciones.usuarios ?? [admin, vendedor]),
          error: signal(opciones.error ?? false),
          cargarUsuarios: cargarUsuariosMock,
          crearUsuario: crearUsuarioMock,
          actualizarUsuario: actualizarUsuarioMock,
          eliminarUsuario: eliminarUsuarioMock,
        },
      },
      {
        provide: AuthService,
        useValue: {
          usuario: signal(
            opciones.emailAutenticado === undefined
              ? { email: admin.email }
              : opciones.emailAutenticado === null
                ? null
                : { email: opciones.emailAutenticado },
          ),
        },
      },
    ],
  });

  const fixture: ComponentFixture<GestionUsuariosComponent> = TestBed.createComponent(GestionUsuariosComponent);
  fixture.detectChanges();

  return { fixture, cargarUsuariosMock, crearUsuarioMock, actualizarUsuarioMock, eliminarUsuarioMock };
}

function botones(fixture: ComponentFixture<GestionUsuariosComponent>, texto: string): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).filter(
    (boton) => (boton as HTMLElement).textContent?.trim() === texto,
  ) as HTMLButtonElement[];
}

function botonAgregar(fixture: ComponentFixture<GestionUsuariosComponent>): HTMLButtonElement {
  return botones(fixture, 'Agregar')[0];
}

/** Fila `<li>` de un usuario, localizada por su email visible. */
function fila(fixture: ComponentFixture<GestionUsuariosComponent>, email: string): HTMLLIElement {
  return Array.from(fixture.nativeElement.querySelectorAll('li')).find((li) =>
    (li as HTMLElement).textContent?.includes(email),
  ) as HTMLLIElement;
}

function botonEnFila(fila: HTMLLIElement, texto: string): HTMLButtonElement {
  return Array.from(fila.querySelectorAll('button')).find(
    (boton) => (boton as HTMLElement).textContent?.trim().startsWith(texto),
  ) as HTMLButtonElement;
}

function llenarFormulario(
  fixture: ComponentFixture<GestionUsuariosComponent>,
  valores: { email: string; nombre: string; rol: 'vendedor' | 'administrador' },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.setValue(valores);
}

function enviarFormulario(fixture: ComponentFixture<GestionUsuariosComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

describe('GestionUsuariosComponent', () => {
  it('carga los usuarios al inicializar y los lista', () => {
    const { fixture, cargarUsuariosMock } = configurarPrueba();

    expect(cargarUsuariosMock).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Admin — admin@letiende.co');
    expect(fixture.nativeElement.textContent).toContain('Vendedor — vendedor@letiende.co');
  });

  it('muestra un mensaje cuando falla la carga de usuarios', () => {
    const { fixture } = configurarPrueba({ usuarios: [], error: true });

    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar los usuarios.');
  });

  it('el formulario está oculto por defecto', () => {
    const { fixture } = configurarPrueba();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('el botón "Agregar" abre el formulario vacío en modo crear, con email habilitado', () => {
    const { fixture } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    const formulario = fixture.nativeElement.querySelector('form');
    expect(formulario).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nuevo usuario');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instancia = fixture.componentInstance as any;
    expect(instancia.formulario.getRawValue()).toEqual({ email: '', nombre: '', rol: 'vendedor' });
    expect(instancia.formulario.controls.email.disabled).toBe(false);
  });

  it('el botón "Editar" de una fila ajena precarga el formulario con email deshabilitado y rol habilitado', () => {
    const { fixture } = configurarPrueba();

    botonEnFila(fila(fixture, vendedor.email), 'Editar').click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instancia = fixture.componentInstance as any;
    expect(instancia.formulario.getRawValue()).toEqual({
      email: vendedor.email,
      nombre: vendedor.nombre,
      rol: vendedor.rol,
    });
    expect(instancia.formulario.controls.email.disabled).toBe(true);
    expect(instancia.formulario.controls.rol.disabled).toBe(false);
  });

  it('crea un usuario nuevo y cierra el formulario', async () => {
    const { fixture, crearUsuarioMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { email: 'nuevo@letiende.co', nombre: 'Nuevo', rol: 'vendedor' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(crearUsuarioMock).toHaveBeenCalledWith({ email: 'nuevo@letiende.co', nombre: 'Nuevo', rol: 'vendedor' });
    expect(fixture.nativeElement.textContent).toContain('Usuario creado correctamente.');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('no envía la petición de creación cuando el formulario es inválido', () => {
    const { fixture, crearUsuarioMock } = configurarPrueba();

    botonAgregar(fixture).click();
    fixture.detectChanges();
    enviarFormulario(fixture);

    expect(crearUsuarioMock).not.toHaveBeenCalled();
  });

  it('actualiza un usuario existente (fila ajena) y cierra el formulario', async () => {
    const { fixture, actualizarUsuarioMock } = configurarPrueba();

    botonEnFila(fila(fixture, vendedor.email), 'Editar').click();
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formulario = (fixture.componentInstance as any).formulario;
    formulario.patchValue({ nombre: 'Vendedor Actualizado', rol: 'administrador' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(actualizarUsuarioMock).toHaveBeenCalledWith(vendedor.email, {
      nombre: 'Vendedor Actualizado',
      rol: 'administrador',
    });
    expect(fixture.nativeElement.textContent).toContain('Usuario actualizado correctamente.');
  });

  it('elimina un usuario (fila ajena) tras confirmar y muestra el mensaje de éxito', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, eliminarUsuarioMock } = configurarPrueba();

    botonEnFila(fila(fixture, vendedor.email), 'Eliminar').click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(eliminarUsuarioMock).toHaveBeenCalledWith(vendedor.email);
    expect(fixture.nativeElement.textContent).toContain('Usuario eliminado correctamente.');
  });

  it('no elimina el usuario cuando se cancela la confirmación', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, eliminarUsuarioMock } = configurarPrueba();

    botonEnFila(fila(fixture, vendedor.email), 'Eliminar').click();
    await Promise.resolve();

    expect(eliminarUsuarioMock).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de error cuando crearUsuario falla (409)', async () => {
    const { fixture, crearUsuarioMock } = configurarPrueba();
    crearUsuarioMock.mockResolvedValue({ exito: false, error: 'Ya existe un usuario registrado con ese email.' });

    botonAgregar(fixture).click();
    fixture.detectChanges();

    llenarFormulario(fixture, { email: vendedor.email, nombre: 'Vendedor', rol: 'vendedor' });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ya existe un usuario registrado con ese email.');
  });

  describe('salvaguarda visual ADR-009 (propia fila del administrador autenticado)', () => {
    it('deshabilita el botón "Eliminar" en la fila del propio administrador autenticado', () => {
      const { fixture } = configurarPrueba({ emailAutenticado: admin.email });

      const botonEliminarPropio = botonEnFila(fila(fixture, admin.email), 'Eliminar');
      const botonEliminarAjeno = botonEnFila(fila(fixture, vendedor.email), 'Eliminar');

      expect(botonEliminarPropio.disabled).toBe(true);
      expect(botonEliminarAjeno.disabled).toBe(false);
    });

    it('muestra un aviso en la fila del propio administrador autenticado', () => {
      const { fixture } = configurarPrueba({ emailAutenticado: admin.email });

      expect(fila(fixture, admin.email).textContent).toContain(
        'No puedes cambiar tu propio rol ni eliminarte a ti mismo.',
      );
      expect(fila(fixture, vendedor.email).textContent).not.toContain(
        'No puedes cambiar tu propio rol ni eliminarte a ti mismo.',
      );
    });

    it('al editar la propia fila, deshabilita el selector de rol y muestra el aviso en el formulario', () => {
      const { fixture } = configurarPrueba({ emailAutenticado: admin.email });

      botonEnFila(fila(fixture, admin.email), 'Editar').click();
      fixture.detectChanges();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instancia = fixture.componentInstance as any;
      expect(instancia.formulario.controls.rol.disabled).toBe(true);
      expect(instancia.formulario.controls.rol.value).toBe('administrador');
      expect(fixture.nativeElement.textContent).toContain('No puedes cambiar tu propio rol de administrador.');
    });

    it('no llama a eliminarUsuario al hacer click en el botón deshabilitado de la propia fila', async () => {
      const { fixture, eliminarUsuarioMock } = configurarPrueba({ emailAutenticado: admin.email });

      botonEnFila(fila(fixture, admin.email), 'Eliminar').click();
      await Promise.resolve();

      expect(eliminarUsuarioMock).not.toHaveBeenCalled();
    });
  });
});
