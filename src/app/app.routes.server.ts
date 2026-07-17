import { RenderMode, ServerRoute } from '@angular/ssr';

// Todas las rutas actuales dependen de un guard (AuthGuard/NoAuthGuard) que
// debe evaluarse en cada petición. RenderMode.Prerender genera HTML estático
// en build time y NUNCA ejecuta guards por petición en el Lambda desplegado
// (verificado: /libros servía 200 en vez de redirigir a /login en staging).
// Server sí ejecuta el guard en cada request. Cuando exista contenido
// público real sin guard (catálogo público, tech-specs.md §4.5), esa ruta
// específica puede volver a Prerender para SEO.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server
  }
];
