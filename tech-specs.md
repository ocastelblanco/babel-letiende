# Especificaciones Técnicas (tech-specs.md) — Babel

Este documento define la arquitectura técnica, las herramientas y los patrones de desarrollo para la implementación del sistema **Babel**. Nivel: referencia — suficiente para retomar el proyecto sin contexto previo.

> Ver PRD §5 para el detalle funcional de cada flujo; este documento explica el "cómo" técnico.

---

## 1. Visión general de la arquitectura

Arquitectura serverless en AWS para el cómputo y almacenamiento (objetivo de costo $0), con Firebase exclusivamente para autenticación, y una API externa ya existente (`api.letiende.co`) como fuente de metadatos de libros.

```
+---------------------------------------------------------------------------------+
|                                  CAPA CLIENTE                                    |
|                                                                                    |
|   +----------------------------+   +----------------------------+                |
|   |  PWA Angular 22 (navegador)|   |  Visitante público (sin     |                |
|   |  Vendedor / Administrador  |   |  autenticación)             |                |
|   |  - Escaneo de código barras|   |  - Búsqueda en catálogo     |                |
|   |  - Catalogación / venta    |   |  - Ficha de libro           |                |
|   |  - Reportes (admin)        |   |                              |                |
|   +--------------+-------------+   +--------------+---------------+               |
|                  |                                |                               |
+------------------|--------------------------------|-------------------------------+
                    |  HTTPS (fetch / SSR)           |  HTTPS (SSR)
+------------------|--------------------------------|-------------------------------+
|                                CAPA SERVICIO (AWS)                                |
|                    v                                v                            |
|   +--------------------------------------------------------------------------+   |
|   |          API Gateway — dominio personalizado babel.letiende.co           |   |
|   +---------------------------------+----------------------------------------+   |
|                                     |                                             |
|          +--------------------------+-------------------------+                  |
|          v                                                     v                  |
|  +------------------------+                        +--------------------------+  |
|  | Lambda "ssr"            |                        | Lambda "api"             |  |
|  | Angular Universal (SSR) |                        | Endpoints /api/*         |  |
|  | Node.js 24.x             |                        | Node.js 24.x              |  |
|  | - Catálogo público SSR  |                        | - CRUD libros/ventas     |  |
|  | - App shell autenticada |                        | - CRUD estantes/usuarios |  |
|  +------------------------+                        | - Orquesta metadatos/PVP |  |
|                                                       +----------+---------------+  |
|                                                                  |                  |
|                                        +-------------------------+-----------+      |
|                                        v                         v           v      |
|                              +----------------+       +----------------+ +-------+ |
|                              | AWS DynamoDB   |       | api.letiende.co| |Scraping| |
|                              | libros/ventas/ |       | (externa,      | |whitelist/| |
|                              | estantes/      |       | ya existente)  | |Google  | |
|                              | usuarios/      |       | Google Books   | |Search  | |
|                              | descuentos     |       | API (proxy)    | |fallback| |
|                              +----------------+       +----------------+ +-------+ |
+------------------------------------------------------------------------------------+
                    |
                    | Google Sign-In (SDK cliente)
                    v
+------------------------------------------------------------------------------------+
|                    Google Firebase Authentication (solo Auth, sin Firestore)       |
+------------------------------------------------------------------------------------+
```

Decisiones clave derivadas de esta visión (detalladas más abajo):
- Dos funciones Lambda dentro de un mismo servicio Serverless: `ssr` (renderizado) y `api` (lógica de negocio/datos), compartiendo dominio y evitando CORS.
- El scraping de PVP se implementa con peticiones HTTP simples + parseo de HTML (sin navegador headless) para mantenerse dentro de la capa gratuita de Lambda (memoria/tiempo de ejecución bajos).
- `api.letiende.co` se consume solo para resolver metadatos de libro por ISBN; el almacenamiento (DynamoDB) y la lógica de negocio de Babel son responsabilidad de este repositorio.

---

## 2. Stack tecnológico completo

| Componente | Tecnología | Versión | Propósito / Justificación | Enlace a documentación |
|---|---|---|---|---|
| **Framework base** | Angular | 22.x | Core del frontend: Signals, Standalone components, SSR con `@angular/ssr`. | [angular.dev](https://angular.dev) |
| **Estilos CSS** | Tailwind CSS | 4.x | Mismo enfoque que Comandante; estilos utilitarios sin CSS custom masivo. | [tailwindcss.com](https://tailwindcss.com) |
| **Runtime** | Node.js | 24.x | Runtime de las funciones Lambda (SSR y API), fijado por requerimiento del proyecto. | [nodejs.org](https://nodejs.org) |
| **IaC / Despliegue** | Serverless Framework | 4.x | Define, empaqueta y despliega las funciones Lambda, API Gateway y permisos IAM. | [serverless.com/framework/docs](https://www.serverless.com/framework/docs) |
| **Cómputo** | AWS Lambda | Node.js 24.x runtime | Ejecuta tanto el SSR de Angular como los endpoints de la API, dentro de la capa siempre gratuita (1M solicitudes/mes). | [AWS Lambda](https://aws.amazon.com/lambda) |
| **Base de datos** | AWS DynamoDB | — | Almacenamiento NoSQL de libros, ventas, estantes, usuarios y descuentos; modo de capacidad aprovisionada (25 RCU/25 WCU) para permanecer en la capa siempre gratuita. | [DynamoDB](https://aws.amazon.com/dynamodb) |
| **Gateway HTTP** | Amazon API Gateway (HTTP API) | — | Expone los Lambdas bajo el dominio `babel.letiende.co`. | [API Gateway](https://aws.amazon.com/api-gateway) |
| **Autenticación** | Firebase Authentication | SDK v10+ | Login con Google (Sign-In) en el cliente; verificación de ID token en el backend con `firebase-admin`. | [Firebase Auth](https://firebase.google.com/docs/auth) |
| **Metadatos de libros** | API externa `api.letiende.co` | — | Servicio ya existente y compartido de Le Tiende; resuelve ISBN → título/autor/portada/editorial vía Google Books API. | (interno Le Tiende) |
| **Scraping de PVP** | `fetch`/`undici` + `cheerio` | — | Consulta sitios de la lista blanca sin navegador headless (más liviano, más barato en Lambda). | [cheerio](https://cheerio.js.org) |
| **Búsqueda de respaldo de precio** | Google Custom Search JSON API | — | Fallback cuando la lista blanca no encuentra el libro; excluye dominios de la lista negra. Cuota gratuita limitada (ver §6). | [Custom Search JSON API](https://developers.google.com/custom-search/v1/overview) |
| **Reportes** | `xlsx` | ^0.18.x | Generación de reportes descargables, mismo paquete usado en Comandante. | [SheetJS](https://docs.sheetjs.com) |
| **Lectura de código de barras** | `@zxing/browser` (o `html5-qrcode`) | — | Lectura de ISBN vía cámara del navegador (`getUserMedia`), sin empaquetado nativo. | [zxing-js](https://github.com/zxing-js/browser) |
| **Formato/Lint** | Prettier | ^3.x | Igual que Comandante, formato consistente. | [prettier.io](https://prettier.io) |

---

## 3. Estructura del repositorio comentada

Monorepo: el frontend Angular SSR y las funciones Lambda de la API viven en el mismo repositorio, desplegadas como un único servicio Serverless.

```
babel-letiende/
├── docs/                          # Documentación adicional (si aplica)
├── src/
│   ├── app/
│   │   ├── core/                  # Guardias, interceptores, servicios globales
│   │   │   ├── auth/              # Login, AuthGuard, RoleGuard, resolución de rol
│   │   │   ├── api/               # Cliente HTTP hacia /api/* (servicios Angular)
│   │   │   └── models/            # Interfaces TypeScript (Libro, Estante, Venta, Usuario...)
│   │   ├── features/              # Módulos por flujo funcional
│   │   │   ├── catalogo-publico/  # Búsqueda y ficha de libro (SSR, sin auth)
│   │   │   ├── catalogar/         # Flujo de catalogación (escaneo, metadatos, precio, estante)
│   │   │   ├── venta/             # Registro de venta
│   │   │   ├── libros/            # Lista de catalogados + cambio de estante
│   │   │   └── admin/             # Reportes, usuarios, editoriales, estantes
│   │   ├── shared/                # Componentes, pipes y directivas reutilizables
│   │   ├── app.config.ts
│   │   ├── app.routes.ts
│   │   └── app.component.ts
│   ├── server.ts                  # Entrypoint SSR de Angular (Express)
│   ├── theme/                     # Tokens de estilo (heredados de Comandante/Le Tiende)
│   └── main.ts
├── server/
│   └── api/                       # Código de la Lambda "api" (Node.js 24.x)
│       ├── handlers/              # Un archivo por grupo de endpoints (libros, ventas, estantes, usuarios, editoriales, metadatos)
│       ├── services/              # Cliente DynamoDB, cliente api.letiende.co, scraping, Google Search fallback
│       └── lib/                   # Verificación de Firebase ID token, utilidades comunes
├── serverless.yml                 # Definición de funciones, recursos DynamoDB, dominio personalizado
├── CLAUDE.md
├── PRD.md
├── tech-specs.md
├── MEMORY.md
├── TODO.md
├── angular.json
├── package.json
└── tsconfig.json
```

### Tabla de alias de rutas (path aliases)

Configurados en `tsconfig.json`:
- `@core/*` → `src/app/core/*`
- `@shared/*` → `src/app/shared/*`
- `@features/*` → `src/app/features/*`
- `@theme/*` → `src/theme/*`

---

## 4. Frontend / Cliente

### 4.1 Patrones arquitectónicos

- **Estado reactivo con Angular Signals:** todo el estado de UI (libro en proceso de catalogación, carrito de venta en curso, filtros del catálogo) usa `Signal`/`WritableSignal`.
- **Servicios unidireccionales de datos:** los componentes no llaman `fetch` directamente; usan servicios en `@core/api/` que exponen Signals de solo lectura sobre el estado sincronizado con la API.
- **Componentes contenedores (Smart) y de presentación (Dumb):** las vistas de `features/` manejan lógica y estado; los subcomponentes en `shared/` (tarjeta de libro, chip de estante, badge de estado) solo renderizan.
- **SSR selectivo:** las rutas del catálogo público (`/`, `/libro/:isbn`) se renderizan en servidor para SEO; las rutas autenticadas pueden hidratarse como aplicación cliente estándar tras el primer render.

### 4.2 Rutas y navegación

| Ruta | Componente | Guard (seguridad) | Modo de carga | Notas |
|---|---|---|---|---|
| `/` | `CatalogoPublicoComponent` | — (pública) | SSR / Eager | Búsqueda y listado del catálogo completo. |
| `/libro/:isbn` | `FichaLibroComponent` | — (pública) | SSR / Lazy | Detalle de un libro: PVP, ubicación, disponibilidad. |
| `/login` | `LoginComponent` | `NoAuthGuard` | Eager | Ingreso con Google. |
| `/catalogar` | `CatalogarLibroComponent` | `AuthGuard` | Lazy | Flujo de catalogación (vendedor/admin). |
| `/venta` | `RegistrarVentaComponent` | `AuthGuard` | Lazy | Registro de venta (vendedor/admin). |
| `/libros` | `ListaLibrosCatalogadosComponent` | `AuthGuard` | Lazy | Lista interna para buscar un libro y cambiar su estante. |
| `/libros/:isbn/estante` | `CambiarEstanteComponent` | `AuthGuard` | Lazy | Edición de ubicación física. |
| `/admin/reportes` | `ReportesVentasComponent` | `AuthGuard` + `RoleGuard(admin)` | Lazy | Filtros y exportación XLSX. |
| `/admin/usuarios` | `GestionUsuariosComponent` | `AuthGuard` + `RoleGuard(admin)` | Lazy | CRUD de vendedores/administradores. |
| `/admin/editoriales` | `DescuentosEditorialesComponent` | `AuthGuard` + `RoleGuard(admin)` | Lazy | CRUD de porcentajes de descuento por editorial. |
| `/admin/estantes` | `GestionEstantesComponent` | `AuthGuard` + `RoleGuard(admin)` | Lazy | CRUD de estantes. |
| `**` | Redirección a `/` | — | — | Fallback global. |

### 4.3 Modelos de datos principales (interfaces TypeScript)

```typescript
interface Libro {
  isbn: string | null;         // null si el libro no tiene ISBN
  bookId: string;              // identificador interno (uuid) — clave primaria si no hay ISBN
  titulo: string;
  autor: string;
  editorial: string | null;
  portadaUrl: string | null;
  pvp: number;                 // en pesos colombianos
  porcentajeDescuentoEditorial: number;
  costo: number;               // derivado de pvp y porcentajeDescuentoEditorial
  cantidadTotal: number;
  cantidadDisponible: number;
  estanteId: string;
  creadoPor: string;           // email del vendedor/admin que catalogó
  creadoEn: string;            // ISO date
  actualizadoEn: string;
}

interface Venta {
  ventaId: string;
  bookId: string;
  isbn: string | null;
  porcentajeDescuentoAplicado: number;
  precioFinal: number;
  formaDePago: 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'daviplata';
  vendidoPor: string;           // email del vendedor
  vendidoEn: string;            // ISO date
}

interface Estante {
  estanteId: string;
  espacio: string;    // ej. "Espacio principal", "Exhibidor terraza", "Salón VIP"
  mueble: string;     // ej. "Biblioteca 1", "Mesa de descuentos"
  ubicacion: string;  // ej. "Estante 1"
}

interface DescuentoEditorial {
  editorial: string;
  porcentajePorDefecto: number;
  porcentajesDisponibles: number[];
}

interface Usuario {
  email: string;
  nombre: string;
  fotoUrl: string | null;
  rol: 'administrador' | 'vendedor';
  creadoEn: string;
}
```

### 4.4 Estilos y sistema de diseño

Se hereda la paleta y tipografía de marca de Le Tiende usada en Comandante (`primary #230C00`, `secondary #E8630A`, `tertiary #00B7A3`, `neutral #FFE7B3`; tipografías Angellya + Poppins). Se recomienda crear un `DESIGN.md` propio de Babel que adapte estos tokens a los componentes específicos del dominio de catalogación (tarjeta de libro, indicador de escaneo, badge de disponibilidad) — ver roadmap técnico §11.

### 4.5 SEO / SSR

- `/` y `/libro/:isbn` se renderizan en servidor (función Lambda `ssr`) para indexabilidad.
- Meta tags dinámicos por libro (título, descripción, imagen de portada) en `/libro/:isbn` para compartición social.
- Sitemap generado a partir del listado de libros disponibles (tarea de roadmap técnico).

---

## 5. Backend / APIs

Todos los endpoints los sirve la función Lambda `api`, bajo el prefijo `/api`. Los endpoints marcados como "Pública" no requieren `Authorization`; el resto exige un `Bearer <Firebase ID Token>` válido, y los marcados "Admin" además exigen `rol = administrador` en la tabla `babel-usuarios`.

| Método | Ruta | Caller | Descripción | Payload / Query |
|---|---|---|---|---|
| GET | `/api/libros` | Pública | Busca/filtra el catálogo (nombre, autor, tema, ISBN). | Query: `q`, `tema`, `pvpMin`, `pvpMax` |
| GET | `/api/libros/:isbn` | Pública | Detalle de un libro disponible. | — |
| GET | `/api/metadatos/:isbn` | Vendedor/Admin | Orquesta `api.letiende.co` (Google Books) + scraping de PVP (lista blanca → Google Search de respaldo). | — |
| POST | `/api/libros` | Vendedor/Admin | Crea un libro catalogado. | `Libro` (sin `bookId`/`creadoEn`) |
| PATCH | `/api/libros/:isbn/estante` | Vendedor/Admin | Cambia el estante de un libro. | `{ estanteId }` |
| POST | `/api/ventas` | Vendedor/Admin | Registra una venta; decrementa `cantidadDisponible`. | `{ bookId, formaDePago, porcentajeDescuentoAplicado }` |
| GET | `/api/ventas` | Admin | Lista/filtra ventas para reportes. | Query: `desde`, `hasta`, `editorial`, `formaDePago` |
| GET | `/api/ventas/exportar` | Admin | Genera y descarga el reporte en XLSX. | Mismos filtros que arriba |
| GET / POST / PUT / DELETE | `/api/estantes` | Admin | CRUD de estantes. | `Estante` |
| GET / POST / PUT / DELETE | `/api/editoriales-descuentos` | Admin | CRUD de descuentos por editorial. | `DescuentoEditorial` |
| GET / POST / PUT / DELETE | `/api/usuarios` | Admin | CRUD de usuarios (vendedores/administradores). | `Usuario` |

### 5.1 Tablas DynamoDB

| Tabla | Clave primaria | Notas |
|---|---|---|
| `babel-libros` | `bookId` (PK) | GSI por `isbn` para búsquedas directas por código de barras. |
| `babel-ventas` | `ventaId` (PK) | GSI por `vendidoEn` (rango de fecha) para reportes. |
| `babel-estantes` | `estanteId` (PK) | — |
| `babel-editoriales-descuentos` | `editorial` (PK) | — |
| `babel-usuarios` | `email` (PK) | Fuente de verdad del rol (`administrador`/`vendedor`). |

**Decisión de diseño:** se usa una tabla `babel-ventas` separada (en vez de sobrescribir el estado del libro) porque los reportes requieren historial por transacción (fecha, forma de pago, utilidad) y un libro catalogado puede tener múltiples ejemplares vendidos en momentos distintos. `babel-libros.cantidadDisponible` se decrementa en cada venta; cuando llega a 0 el libro deja de aparecer como disponible en el catálogo público.

---

## 6. Servicios externos

| Servicio | Estado | Uso actual/futuro |
|---|---|---|
| `api.letiende.co` | Ya existente, compartido | Resolver metadatos de libro (título, autor, portada, editorial) a partir de ISBN u otros datos, vía Google Books API. |
| Firebase Authentication | Por configurar (proyecto Firebase nuevo o compartido — confirmar con el administrador) | Login con Google y emisión de ID Token verificado en el backend. |
| Sitios de la lista blanca (scraping) | Por definir | Fuente primaria de PVP por nombre del libro. Lista mantenida como configuración estática en el repo (no editable desde la UI de administración en el alcance actual). |
| Google Custom Search JSON API | Por habilitar | Fallback de búsqueda de PVP cuando la lista blanca no encuentra el libro, excluyendo la lista negra. **Cuota gratuita limitada (100 consultas/día)** — riesgo de costo si el volumen de catalogación la supera; ver §9 y PRD §9. |

---

## 7. Infraestructura

### 7.1 Diagrama de despliegue

Ver diagrama de §1. Componentes gestionados por Serverless Framework: 2 funciones Lambda, API Gateway HTTP API, dominio personalizado, y las 5 tablas DynamoDB de §5.1.

### 7.2 Entornos

| Stage | URL | Variables clave | Comando de despliegue |
|---|---|---|---|
| `dev` (local) | `http://localhost:4200` (Angular) + `http://localhost:3000` (API local, `serverless-offline`) | `.env.local` | `npm run start` |
| `staging` | URL generada por API Gateway (`*.execute-api.*.amazonaws.com/staging`) o `staging.babel.letiende.co` | Secrets de GitHub Actions, stage `staging` | `npx serverless deploy --stage staging` |
| `production` | `https://babel.letiende.co` | Secrets de GitHub Actions, stage `production` | `npx serverless deploy --stage production` |

### 7.3 Costo — decisiones para mantenerlo en $0

- **Lambda:** dentro de la capa siempre gratuita de AWS (1M solicitudes/mes, 400.000 GB-segundos de cómputo).
- **DynamoDB:** capacidad aprovisionada 25 RCU/25 WCU por tabla (capa siempre gratuita), evitando el modo on-demand si el volumen de solicitudes pudiera generar cargos.
- **Scraping sin navegador headless:** reduce tiempo de ejecución y memoria de Lambda frente a Puppeteer/Playwright.
- **Route53/API Gateway/ACM:** se asume una hosted zone ya existente para `letiende.co` (reutilizada de Comandante/api.letiende.co); certificados ACM son gratuitos.
- **Riesgo de costo no cero:** Google Custom Search API más allá de la cuota gratuita diaria, y API Gateway HTTP API más allá de los primeros 12 meses de capa gratuita (después: ~US$1 por millón de solicitudes). Dado el volumen esperado (uso interno + catálogo público de una sola librería), el costo estimado más allá del free tier es marginal, pero no está garantizado en $0 absoluto de forma indefinida — validar precios vigentes de AWS antes de lanzar a producción.

---

## 8. Autenticación y seguridad

- El cliente Angular inicia sesión con `signInWithPopup`/`signInWithRedirect` de Firebase Authentication (proveedor Google).
- El ID Token de Firebase se envía como `Authorization: Bearer <token>` en cada llamada a `/api/*` que no sea pública.
- La Lambda `api` verifica el token con `firebase-admin` (`verifyIdToken`) en cada solicitud protegida — nunca se confía en un rol enviado desde el cliente.
- El rol (`administrador`/`vendedor`) se resuelve consultando `babel-usuarios` por el email del token verificado; si el correo no existe en la tabla, la solicitud se rechaza con 403.
- Los guards de Angular (`AuthGuard`, `RoleGuard`) son solo experiencia de usuario — la autorización real ocurre siempre en la Lambda `api`.

---

## 9. Gestión de secretos

| Variable | Propósito | Contexto |
|---|---|---|
| `FIREBASE_PROJECT_ID` / config cliente Firebase | Inicializar el SDK cliente de Firebase Authentication | Frontend (`src/environments/`), no sensible (config pública de Firebase) |
| `FIREBASE_SERVICE_ACCOUNT_BABEL` | Credenciales de servicio para `firebase-admin` (verificar ID tokens) | Backend Lambda `api` — GitHub Secret, nunca en el repo |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (o rol OIDC) | Despliegue con Serverless Framework desde GitHub Actions | GitHub Secrets / OIDC federado |
| `GOOGLE_CUSTOM_SEARCH_API_KEY` / `GOOGLE_CUSTOM_SEARCH_CX` | Fallback de búsqueda de PVP en Google | GitHub Secrets → variable de entorno de la Lambda `api` |
| `API_LETIENDE_BASE_URL` | URL base de la API externa de metadatos | Variable de entorno por stage (no secreta) |

**Regla:** ningún secreto se hardcodea en el repositorio ni en `serverless.yml`; todos se inyectan como variables de entorno de la Lambda a través de GitHub Actions Secrets.

---

## 10. Convenciones de código y git flow

Ver `CLAUDE.md` §4 (convenciones de código) y §6 (Git Flow para Agentes IA) — este último se agrega a `CLAUDE.md` inmediatamente después de este documento, siguiendo el mismo patrón que usa Comandante (rama `main` protegida, ramas `feature/*`, `fix/*`, `docs/*`, `hotfix/*`, `refactor/*`, PRs obligatorios).

---

## 11. Roadmap técnico

| Feature | Archivos a crear | Dependencias |
|---|---|---|
| Scaffold del proyecto (Angular 22 + SSR + Serverless Framework) | `angular.json`, `package.json`, `serverless.yml`, `src/server.ts` | — |
| Autenticación Firebase + resolución de rol | `src/app/core/auth/*`, `server/api/lib/verificar-token.ts`, tabla `babel-usuarios` | Scaffold del proyecto |
| Flujo de catalogación | `src/app/features/catalogar/*`, `server/api/handlers/libros.ts`, `server/api/handlers/metadatos.ts`, `server/api/services/scraping.ts` | Autenticación, tabla `babel-libros`, integración `api.letiende.co` |
| Registro de venta | `src/app/features/venta/*`, `server/api/handlers/ventas.ts`, tabla `babel-ventas` | Flujo de catalogación |
| Catálogo público SSR | `src/app/features/catalogo-publico/*`, meta tags dinámicos | Tabla `babel-libros` con datos |
| Cambio de estante | `src/app/features/libros/*`, `server/api/handlers/libros.ts` (PATCH) | Flujo de catalogación, tabla `babel-estantes` |
| Configuración (estantes, editoriales, usuarios) | `src/app/features/admin/*`, `server/api/handlers/estantes.ts`, `editoriales.ts`, `usuarios.ts` | Autenticación con rol admin |
| Reportes de ventas + XLSX | `src/app/features/admin/reportes/*`, `server/api/handlers/ventas.ts` (GET/exportar) | Registro de venta |
| `DESIGN.md` propio de Babel | `DESIGN.md` | Definición de componentes del dominio de catalogación |
