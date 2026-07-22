import { RenderMode, ServerRoute } from '@angular/ssr';

// Todas las rutas actuales dependen de un guard (AuthGuard/NoAuthGuard) que
// debe evaluarse en cada petición. RenderMode.Prerender genera HTML estático
// en build time y NUNCA ejecuta guards por petición en el Lambda desplegado
// (verificado: /libros servía 200 en vez de redirigir a /login en staging).
// Server sí ejecuta el guard en cada request. Cuando exista contenido
// público real sin guard (catálogo público, tech-specs.md §4.5), esa ruta
// específica puede volver a Prerender para SEO.
//
// ⚠️ /libros y /catalogar (protegidas por AuthGuard/RoleGuard) son
// RenderMode.Client, NO Server, a diferencia del resto: la sesión de
// Firebase vive solo en el navegador (IndexedDB del SDK cliente, sin cookie
// de sesión) — el Lambda ssr nunca puede saber si hay una sesión real. Con
// Server, el guard se evaluaba en cada carga completa de página SIN acceso
// a esa sesión, así que SIEMPRE redirigía a /login, autenticado o no
// (confirmado en vivo: un usuario real con sesión activa quedaba atrapado
// en un bucle de redirección a /login al entrar por URL directa/refresh).
// Con Client, esas rutas no se renderizan en el servidor — el navegador
// hace CSR completo, donde el guard sí puede leer la sesión real
// (`AuthService.esperarListo()`, ver `auth.guard.ts`). Ver MEMORY.md §7.
export const serverRoutes: ServerRoute[] = [
  {
    path: 'libros',
    renderMode: RenderMode.Client
  },
  {
    path: 'libros/:bookId/estante',
    renderMode: RenderMode.Client
  },
  {
    path: 'catalogar',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin/estantes',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin/sitios',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin/usuarios',
    renderMode: RenderMode.Client
  },
  {
    path: 'admin/editoriales',
    renderMode: RenderMode.Client
  },
  {
    path: '**',
    renderMode: RenderMode.Server
  }
];
