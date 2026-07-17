import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { environment } from '../../../environments/environment';

/**
 * Autenticación con Google vía Firebase Authentication (proyecto compartido
 * `comandante-letiende` — ver MEMORY.md ADR-007 y tech-specs.md §8.1).
 *
 * La app/Auth de Firebase solo se inicializa en el navegador: el SDK cliente
 * depende de almacenamiento del navegador (indexedDB/localStorage) para la
 * persistencia de sesión, que no existe durante el renderizado en servidor
 * (Lambda `ssr`). En servidor, `usuario` simplemente permanece en `null`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly appFirebase: FirebaseApp | null = this.esNavegador
    ? initializeApp(environment.firebase)
    : null;
  private readonly auth: Auth | null = this.appFirebase ? getAuth(this.appFirebase) : null;

  private readonly usuarioSignal = signal<User | null>(null);
  /** Usuario autenticado (o `null`). Solo identidad — el rol se resuelve siempre en la Lambda `api`. */
  readonly usuario = this.usuarioSignal.asReadonly();

  constructor() {
    if (this.auth) {
      onAuthStateChanged(this.auth, (usuario) => this.usuarioSignal.set(usuario));
    }
  }

  /** Abre el popup de Google Sign-In. Restringido solo a Google (tech-specs.md §8.1, "blast radius"). */
  async iniciarSesionConGoogle(): Promise<User> {
    if (!this.auth) {
      throw new Error('El inicio de sesión solo está disponible en el navegador.');
    }
    const proveedor = new GoogleAuthProvider();
    const credencial = await signInWithPopup(this.auth, proveedor);
    this.usuarioSignal.set(credencial.user);
    return credencial.user;
  }

  /** Cierra la sesión de Firebase y limpia todo el estado reactivo del cliente (CLAUDE.md, A07). */
  async cerrarSesion(): Promise<void> {
    if (this.auth) {
      await signOut(this.auth);
    }
    this.usuarioSignal.set(null);
  }
}
