# CLAUDE.md — Instrucciones del Proyecto Babel

Este archivo contiene las directrices permanentes de arquitectura, código, seguridad y flujo de desarrollo para agentes IA y desarrolladores en el proyecto **Babel**.

---

## 1. Descripción del Proyecto

**Babel** es la aplicación de catalogación e inventario de la librería del centro cultural **Le Tiende** (Bogotá, Colombia). Permite a vendedores catalogar libros escaneando su código de barras (ISBN), completar automáticamente sus datos (autor, portada, editorial, precio de venta al público) y ubicarlos físicamente en un estante. También permite registrar la venta de un libro y, para el administrador, generar reportes financieros y configurar catálogo, usuarios, estantes y descuentos editoriales. Adicionalmente expone un catálogo público de consulta, sin necesidad de autenticación.

El caso de uso fundacional es catalogar un inventario inicial de **más de 3.000 libros**, por lo que el flujo de catalogación es la ruta crítica de rendimiento de todo el sistema.

---

## 2. Stack Tecnológico y Versiones

- **Frontend Framework:** Angular 22.x (Standalone components, Signals, Router, SSR con `@angular/ssr`)
- **Tipo de aplicación:** PWA responsive (Mobile-First para catalogación/venta, Desktop para administración) — sin empaquetado nativo (Capacitor/Cordova) en el alcance actual
- **CSS Utility:** Tailwind CSS 4.x (mismo enfoque que Comandante)
- **Runtime backend:** Node.js 24.x
- **Despliegue/Infraestructura:** AWS Lambda + API Gateway, gestionados con Serverless Framework (IaC)
- **Base de datos:** AWS DynamoDB (on-demand/provisioned dentro de la capa gratuita)
- **Autenticación:** Google Firebase Authentication (SDK v10+, Google Sign-In) — únicamente autenticación, no se usa Firestore
- **Metadatos de libros:** API externa ya existente y compartida en `https://api.letiende.co` (proxy sobre Google Books API)
- **Generación de reportes:** librería `xlsx` (mismo paquete que usa Comandante)
- **Lectura de código de barras:** librería web basada en `getUserMedia` (p. ej. `@zxing/browser` o `html5-qrcode`) — ver decisión final en tech-specs.md
- **Objetivo de costo de infraestructura:** $0 (o lo más cercano posible dentro de la capa gratuita de AWS)

---

## 3. Comandos de Uso Común

> Se completarán/ajustarán una vez exista `package.json` (Tarea 1 de `TODO.md`). Referencia esperada, análoga a Comandante:

- **Iniciar servidor de desarrollo local:** `npm run start` (o `ng serve`)
- **Ejecutar pruebas unitarias:** `npm run test`
- **Compilar producción (Build SSR):** `npm run build -- --configuration=production`
- **Ejecutar en modo servidor local (SSR):** `npm run serve:ssr`
- **Desplegar en Staging:** `npx serverless deploy --stage staging`
- **Desplegar en Producción:** `npx serverless deploy --stage production`

---

## 4. Convenciones de Código e Idioma

- **Idioma del código:** Variables, funciones, clases, tablas de base de datos, commits y comentarios **en español** (ej. `libro`, `ServicioCatalogacion`, `obtenerLibrosPendientes`).
- **Idioma de interfaz:** Español (Colombia) en toda la interfaz, documentación y comunicación con el usuario final.
- **Patrones reactivos:** Uso preferencial de **Angular Signals** para el manejo de estado en lugar de `BehaviorSubject`.
- **Estructura de componentes:** Componentes Standalone obligatorios. Estilos y plantillas en línea para componentes muy pequeños (< 100 líneas); archivos separados (`.html`, `.css`) para componentes grandes.
- **Tipado:** TypeScript estricto. Prohibido el uso de `any`.
- **Precios:** formato colombiano `$45.000` (punto como separador de miles, sin decimales para COP).
- **Identidad visual:** hereda la filosofía y el sistema de marca de **Comandante** (`ocastelblanco/comandante-letiende`) — paleta Le Tiende (`primary #230C00`, `secondary #E8630A`, `tertiary #00B7A3`, `neutral #FFE7B3`), tipografías Angellya (marca) + Poppins (interfaz). Se recomienda crear un `DESIGN.md` propio de Babel adaptando estos tokens a los patrones específicos del catálogo de libros (ver Tarea sugerida en `TODO.md`/roadmap).

---

## 5. Seguridad (OWASP)

Esta sección define las reglas de seguridad obligatorias basadas en los riesgos específicos de la arquitectura de Babel (Angular SSR + Lambda + DynamoDB + Firebase Authentication + scraping/búsqueda externa). Ver `tech-specs.md` para el detalle completo de la arquitectura.

### Riesgos identificados y reglas de código

#### A01:2021 — Control de acceso roto
*   **Riesgo:** un vendedor podría intentar llamar directamente a un endpoint de administrador (`/api/usuarios`, `/api/ventas/exportar`, etc.) o manipular su rol enviándolo desde el cliente.
*   **Regla:** los guardias de Angular (`AuthGuard`, `RoleGuard`) son solo experiencia de usuario. La autorización real ocurre SIEMPRE en la Lambda `api`: cada endpoint protegido verifica el Firebase ID Token y resuelve el rol consultando `babel-usuarios` por el email del token — nunca confiar en un rol enviado en el payload de la petición.

#### A02:2021 — Fallas criptográficas (fuga de secretos)
*   **Riesgo:** exponer la cuenta de servicio de Firebase (`firebase-admin`), las credenciales de AWS o las llaves de Google Custom Search en el repositorio.
*   **Regla:** ninguna credencial privada (`*.json` de cuenta de servicio, `.env`) se commitea. Todos los secretos de `tech-specs.md` §9 se inyectan como variables de entorno vía GitHub Actions Secrets. La configuración pública del SDK cliente de Firebase (`environments/`) no es sensible y puede vivir en el repo.

#### A03:2021 — Inyección (XSS)
*   **Riesgo:** renderizar directamente títulos, autores o fragmentos de HTML obtenidos por scraping de sitios externos o de la API de metadatos, que podrían contener scripts maliciosos.
*   **Regla:** usar siempre interpolación estándar de Angular (`{{ value }}`). El módulo de scraping (`server/api/services/scraping.ts`) SOLO extrae texto/números planos (con `cheerio`, seleccionando nodos específicos) — nunca se reenvía ni se renderiza HTML crudo de un tercero. Prohibido `innerHTML` o `bypassSecurityTrustHtml` sin sanitización explícita con `DomSanitizer`.

#### A05:2021 — Configuración de seguridad incorrecta
*   **Riesgo:** endpoints de administrador expuestos sin protección por un error de ruteo, mensajes de error con stack traces en producción, o permisos IAM de la Lambda más amplios de lo necesario.
*   **Regla:** el rol IAM de ejecución de cada Lambda sigue el principio de mínimo privilegio (solo acceso a las tablas DynamoDB que usa). Las respuestas de error en producción nunca incluyen stack traces ni detalles internos — solo un mensaje genérico y un código HTTP apropiado.

#### A07:2021 — Fallas de identificación y autenticación
*   **Riesgo:** sesiones que no expiran, tokens revocados que se siguen aceptando, o cierre de sesión incompleto.
*   **Regla:** cada solicitud protegida a `/api/*` verifica el ID Token de Firebase con `verifyIdToken` (que valida expiración y revocación). Al cerrar sesión, se invoca `signOut(auth)` y se limpia todo el estado reactivo (Signals) del cliente antes de redirigir a `/login`.

#### A08:2021 — Fallas de integridad de software y datos
*   **Riesgo:** aceptar sin validación un precio (PVP) obtenido automáticamente por scraping o por la búsqueda de respaldo en Google, que podría ser incorrecto, manipulado o corresponder a un producto distinto.
*   **Regla:** todo dato obtenido automáticamente (metadatos, PVP) se PRE-carga como sugerencia editable — el vendedor siempre puede revisar y corregir antes de guardar. El backend valida que el PVP sugerido sea un número positivo dentro de un rango razonable antes de pre-cargarlo. Las dependencias de npm se instalan siempre con `package-lock.json` (`npm ci` en CI), nunca con rangos de versión sin bloquear en producción.

#### A10:2021 — Server-Side Request Forgery (SSRF)
*   **Riesgo:** el módulo de scraping/búsqueda de PVP construye y ejecuta peticiones HTTP salientes desde la Lambda hacia URLs derivadas de datos externos (resultados de búsqueda, nombre del libro); un actor malicioso podría intentar que el servidor haga peticiones a endpoints internos de AWS (ej. `169.254.169.254`, metadata service) o a otros destinos no previstos.
*   **Regla:** el scraping SOLO hace peticiones a dominios que están explícitamente en la lista blanca (`server/api/services/scraping.ts`, config estática del repo). Los resultados de la Google Custom Search API se filtran contra la lista negra Y se valida que el dominio resultante sea un hostname público válido antes de hacer cualquier `fetch`. Prohibido construir URLs de destino a partir de redirecciones no verificadas o de rangos de IP privados/link-local.

### Prohibiciones absolutas en el código

| Acción prohibida | Por qué |
|---|---|
| Confiar en un campo `rol` enviado desde el cliente | Permite escalar privilegios a administrador |
| Hacer `fetch`/scraping a un dominio fuera de la lista blanca sin pasar por el filtro de lista negra + validación de host | Abre la puerta a SSRF |
| Renderizar HTML crudo obtenido de un tercero (`innerHTML`, `bypassSecurityTrustHtml` sin sanitizar) | Vector de XSS |
| Commitear `firebase-service-account*.json`, `.env`, credenciales de AWS | Exposición de secretos |
| Guardar el rol del usuario en `localStorage` para validar permisos | Los datos del cliente son manipulables con herramientas de desarrollador |
| Usar `eval()` o `new Function()` | Vector de ejecución de código arbitrario |
| `npm install` sin `package-lock.json` en CI/CD | Rompe la integridad reproducible del build |

---

## 6. Git Flow para Agentes IA

Las siguientes reglas son **absolutamente obligatorias y no tienen excepción**, incluso si el usuario lo solicita explícitamente. Mismo esquema que usa Comandante (`ocastelblanco/comandante-letiende`).

> **⛔ PROHIBICIÓN CRÍTICA: Un agente IA NUNCA puede hacer commits ni push directamente a `main`. Toda modificación de código debe llegar únicamente a través de un Pull Request revisado y aprobado por un humano.**

### Mapa de ramas

| Rama | Propósito | Protegida |
|---|---|---|
| `main` | Código en producción (`babel.letiende.co`). Solo recibe merges aprobados vía PR. | ✅ Sí |
| `feature/*` | Nuevas funcionalidades. Se crea siempre desde `main`. | No |
| `fix/*` | Correcciones de bugs. Se crea desde `main`. | No |
| `docs/*` | Solo documentación. Se crea desde `main`. | No |
| `hotfix/*` | Correcciones urgentes en producción. Se crea desde `main`. | No |
| `refactor/*` | Refactorizaciones sin cambio funcional. Se crea desde `main`. | No |

### Protocolo obligatorio antes de cualquier cambio de código

**Paso 1 — Verificar en qué rama estoy:**
```bash
git branch --show-current
```
Si el resultado es `main`: **detener todo y ejecutar el Paso 2**.
Si ya hay una feature branch activa: continuar desde el Paso 3.

**Paso 2 — Crear feature branch (SIEMPRE desde `main`):**
```bash
git checkout main
git pull origin main
git checkout -b feature/descripcion-corta-en-kebab-case
```

**Paso 3 — Hacer los cambios y commitear:**
```bash
# Solo después de que el build pase sin errores
npm run build

# Agregar archivos específicos — NUNCA git add . o git add -A
git add src/app/features/catalogar/catalogar-libro.component.ts

# Commit con formato semántico (español colombiano)
git commit -m "feat(catalogar): agrega captura de ISBN por cámara"
```

**Paso 4 — Crear el Pull Request al finalizar:**
```bash
git push -u origin HEAD
gh pr create \
  --base main \
  --title "feat(catalogar): agrega captura de ISBN por cámara" \
  --body "## Cambios realizados
- [bullet con cada cambio]

## Cómo probar
- [pasos verificables]

## Checklist
- [ ] Build pasa sin errores
- [ ] No hay secretos hardcodeados
- [ ] Seguí las convenciones de código del proyecto

🤖 Generado con Claude Code"
```

### Prohibiciones absolutas de Git

| Acción prohibida | Por qué |
|---|---|
| `git push origin main` | Commit directo a producción — **terminantemente prohibido** |
| `git commit` estando en `main` | Genera historial sucio en la rama protegida |
| `git push --force` en cualquier rama | Destruye el historial del repositorio |
| `git merge` de cualquier PR | Solo humanos pueden aprobar y fusionar PRs |
| `gh pr merge` | Solo humanos pueden fusionar PRs |
| `git add .` o `git add -A` | Puede incluir secretos, `.env` o archivos temporales |
| `--no-verify` en commits o pushes | Omite hooks de seguridad configurados |

### El agente NUNCA debe
- Fusionar un PR (ni con `gh pr merge`, ni con `git merge`).
- Aprobar su propio PR.
- Hacer push a `main` bajo ninguna circunstancia, incluso si el usuario lo pide.
- Usar `--force`, `--no-verify`, ni `--no-gpg-sign`.
- Cerrar un PR sin fusionar cuando el trabajo está completo — dejarlo abierto para revisión humana.

---

## 7. Hallazgos Técnicos del Stack (Gotchas)

Esta sección documenta comportamientos no obvios descubiertos durante el desarrollo. Leer antes de tocar la configuración del build o del despliegue. Se irá completando durante la implementación; por ahora se listan riesgos ya conocidos por analogía con Comandante y con el stack elegido:

### Acceso a cámara para código de barras requiere HTTPS y gesto del usuario
`getUserMedia` solo funciona en contextos seguros (HTTPS o `localhost`) y requiere que el usuario conceda permiso explícito con una interacción directa (tap en un botón "Escanear"). En iOS Safari, además, el primer acceso a cámara dentro de una PWA puede fallar silenciosamente si se invoca automáticamente al cargar la página — siempre disparar la solicitud de cámara desde un manejador de click/tap.

### Avatar de Google (`lh3.googleusercontent.com`) — 429 Too Many Requests
Mismo hallazgo que en Comandante: añadir siempre `referrerpolicy="no-referrer"` en cualquier `<img>` que cargue una foto de perfil de Google.

### Cold starts de Lambda en SSR
El primer request tras inactividad a una función Lambda que sirve SSR de Angular puede tardar significativamente más (cold start incluye bootstrap de Node + Angular Universal). Evaluar `provisioned concurrency` solo si el costo lo justifica (rompe el objetivo de $0); por defecto, aceptar la latencia en frío y optimizar el bundle del servidor.
