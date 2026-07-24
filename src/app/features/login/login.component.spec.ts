import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
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

function configurarPrueba() {
  const iniciarSesionConGoogleMock = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { iniciarSesionConGoogle: iniciarSesionConGoogleMock } },
    ],
  });

  const fixture: ComponentFixture<LoginComponent> = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();

  return { fixture, iniciarSesionConGoogleMock };
}

describe('LoginComponent', () => {
  it('muestra un vínculo de regreso al catálogo público', () => {
    const { fixture } = configurarPrueba();

    const enlace = fixture.nativeElement.querySelector('a[href="/"]') as HTMLAnchorElement;

    expect(enlace).toBeTruthy();
    expect(enlace.textContent).toContain('Volver al catálogo');
  });

  it('el botón de Google sigue disparando iniciarSesionConGoogle', async () => {
    const { fixture, iniciarSesionConGoogleMock } = configurarPrueba();

    const boton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    boton.click();
    await Promise.resolve();

    expect(iniciarSesionConGoogleMock).toHaveBeenCalledTimes(1);
  });
});
