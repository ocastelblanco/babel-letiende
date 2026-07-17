import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    // Instancia el AuthService al arrancar la app para que el listener de
    // sesión de Firebase (onAuthStateChanged) arranque antes de que el
    // AuthGuard evalúe el Signal `usuario` en la primera navegación.
    provideAppInitializer(() => {
      inject(AuthService);
    }),
  ]
};
