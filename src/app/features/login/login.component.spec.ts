import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UsuariosService } from '../../core/api/usuarios.service';
import { Usuario } from '../../core/models/usuario.model';
import { LoginComponent } from './login.component';

// `auth.service.ts` (importado abajo solo como token de DI) importa el SDK
// real de Firebase a nivel de módulo — mismo motivo de mock que en el resto
// de specs que tocan AuthService (ver `catalogar-libro.component.spec.ts`).
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

const usuarioVendedor: Usuario = {
  email: 'vendedor@letiende.co',
  nombre: 'Vendedor de prueba',
  fotoUrl: null,
  rol: 'vendedor',
  creadoEn: '2026-01-01T00:00:00.000Z',
};

function configurarPrueba(usuarioResuelto: Usuario | null = usuarioVendedor) {
  const iniciarSesionConGoogleMock = vi.fn().mockResolvedValue(undefined);
  const cerrarSesionMock = vi.fn().mockResolvedValue(undefined);
  const obtenerUsuarioActualMock = vi.fn().mockResolvedValue(usuarioResuelto);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: { iniciarSesionConGoogle: iniciarSesionConGoogleMock, cerrarSesion: cerrarSesionMock },
      },
      { provide: UsuariosService, useValue: { obtenerUsuarioActual: obtenerUsuarioActualMock } },
    ],
  });

  const fixture: ComponentFixture<LoginComponent> = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();

  return { fixture, iniciarSesionConGoogleMock, cerrarSesionMock, obtenerUsuarioActualMock };
}

describe('LoginComponent', () => {
  it('el botón de Google sigue disparando iniciarSesionConGoogle', async () => {
    const { fixture, iniciarSesionConGoogleMock } = configurarPrueba();

    const boton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    boton.click();
    await Promise.resolve();

    expect(iniciarSesionConGoogleMock).toHaveBeenCalledTimes(1);
  });

  it('si el correo no existe en babel-usuarios, cierra la sesión y muestra el mensaje de otro proyecto Le Tiende', async () => {
    const { fixture, cerrarSesionMock } = configurarPrueba(null);

    const boton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    boton.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(cerrarSesionMock).toHaveBeenCalledTimes(1);
    const mensaje = fixture.nativeElement.querySelector('p')?.textContent ?? '';
    expect(mensaje).toContain('otro proyecto de Le Tiende');
  });
});
