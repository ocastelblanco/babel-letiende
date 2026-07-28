# DESIGN.md — Sistema de Diseño de Babel

Este documento describe los patrones visuales (Tailwind CSS 4.x) que **ya existen** en el código de Babel. No prescribe un ideal nuevo: documenta la realidad tal como está implementada en los componentes de catalogación, venta, catálogo público y administración, incluyendo los pequeños desvíos entre componentes. Hereda la identidad de marca de **Comandante** (`ocastelblanco/comandante-letiende`), adaptada a los patrones específicos del catálogo de libros de Babel.

Fuente de verdad de los tokens: `src/styles.css` (bloque `@theme`).

---

## 1. Identidad de marca

### 1.1 Colores

Definidos como variables de tema de Tailwind 4 en `src/styles.css:12-23` y usados en las plantillas como clases utilitarias (`bg-primary`, `text-primary/70`, `border-danger/40`, etc.).

| Token | Valor hex | Uso principal en el código |
|---|---|---|
| `primary` | `#230C00` | Texto principal, fondo de botones primarios, bordes sutiles (`border-primary/10`, `border-primary/20`) |
| `secondary` | `#E8630A` | Acentos puntuales — precio del catálogo público (`text-secondary`), enlaces (`text-secondary underline`) |
| `tertiary` | `#00B7A3` | Mensajes de éxito (`text-tertiary`) |
| `neutral` | `#FFE7B3` | Texto sobre fondo `bg-primary` (botones primarios: `text-neutral`) |
| `surface` | `#FFF8F1` | Fondo de página (`bg-surface`) — medido por pixel en `comandante.letiende.co`, más claro que el `#F7F5F2` documentado en el `DESIGN.md` de Comandante; el código prioriza el valor real desplegado (`src/styles.css:17-19`) |
| `danger` | `#C0392B` | Mensajes de error, botones de eliminar — no forma parte de la paleta original de Comandante, es una adición propia de Babel |

`primary`, `secondary`, `tertiary` y `neutral` coinciden exactamente con los valores documentados en `CLAUDE.md` §4 (`#230C00`, `#E8630A`, `#00B7A3`, `#FFE7B3`).

### 1.2 Tipografía

- **Interfaz:** Poppins, única tipografía usada en componentes (`--font-sans` en `src/styles.css:22`, aplicada globalmente en `body` en `src/styles.css:25-27`).
- **Angellya:** reservada para el nombre de marca dentro del logotipo SVG (`/logo_negro_sin_fondo.svg`, usado en `login.component.html:3-7` y `catalogo-publico.component.html:3`). No existe como archivo de fuente cargable en ningún repo de Le Tiende — nunca se integra en desarrollo. El texto "Babel" en la pantalla de login usa Poppins (`login.component.html:8`), no Angellya.

### 1.3 Formato de precios

`$45.000` — punto como separador de miles, sin decimales. Implementado en `src/app/shared/pipes/pvp.pipe.ts` con `Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })` en vez de `CurrencyPipe`/`DecimalPipe` de Angular, para no depender de registrar los datos de locale `es-CO` (complica el bundle SSR). Se usa como pipe `| pvp` en las plantillas, ej. `catalogo-publico.component.html:35`: `{{ libro.pvp | pvp }}`.

---

## 2. Estructura de página

Todas las páginas de features comparten el mismo contenedor raíz:

```html
<div class="min-h-screen bg-surface px-4 py-8">
  <div class="mx-auto max-w-2xl">
    ...
  </div>
</div>
```

Ejemplo: `gestion-estantes.component.html:1-2`.

El ancho máximo del contenedor interno varía según el tipo de página:

| `max-w-*` | Usado en | Ejemplo |
|---|---|---|
| `max-w-2xl` | Páginas de administración con lista + formulario (CRUD) | `gestion-estantes.component.html:2`, `gestion-usuarios.component.html:2` |
| `max-w-xl` | Formularios de una sola entidad y páginas de navegación simple | `catalogar-libro.component.html:2`, `cambiar-estante.component.html:2`, `admin-inicio.component.html:2` |
| `max-w-5xl` | Catálogo público (grid de tarjetas) | `catalogo-publico.component.html:2`, `catalogo-publico.component.html:7` |
| `max-w-sm` | Tarjeta de login (patrón distinto, ver más abajo) | `login.component.html:2` |

**Desvío documentado:** `login.component.html:1` NO usa el contenedor raíz estándar. En su lugar usa `fixed inset-0 flex items-center justify-center overflow-y-auto bg-surface px-4` para centrar una tarjeta única en toda la pantalla, sin scroll de página — coherente con ser una pantalla de entrada sin navegación, pero distinto al resto de features.

Título de página (`<h1>`): siempre `text-2xl font-bold text-primary`. El margen inferior varía según si hay un párrafo descriptivo debajo:
- `mb-2` cuando le sigue un `<p class="mb-6 text-sm text-primary/70">` descriptivo (`gestion-estantes.component.html:3-4`, `gestion-sitios-scraping.component.html:3-6`).
- `mb-6` cuando no hay párrafo descriptivo (`catalogar-libro.component.html:3`, `cambiar-estante.component.html:4`).

---

## 3. Componentes reutilizables

### 3.1 Tarjetas

Base común: `rounded-2xl bg-white shadow-[0_4px_16px_rgba(35,12,0,0.08)]`. El padding varía según el contenido:

| Variante | Clase completa | Ejemplo |
|---|---|---|
| Tarjeta de formulario | `rounded-2xl bg-white p-6 shadow-[0_4px_16px_rgba(35,12,0,0.08)]` | `gestion-estantes.component.html:9` |
| Tarjeta contenedora de lista | `rounded-2xl bg-white p-4 shadow-[0_4px_16px_rgba(35,12,0,0.08)]` | `gestion-estantes.component.html:81`, `admin-inicio.component.html:12` (enlace de navegación) |
| Tarjeta de libro (catálogo público) | `flex flex-col rounded-2xl bg-white p-3 shadow-[0_4px_16px_rgba(35,12,0,0.08)]` | `catalogo-publico.component.html:19` |

**Desvío documentado:** la tarjeta de login (`login.component.html:2`) usa `p-8` y una sombra más intensa, `shadow-[0_4px_16px_rgba(35,12,0,0.15)]` (alpha `0.15` en vez de `0.08` en todas las demás tarjetas del proyecto).

Filas dentro de una lista (no son tarjetas, son ítems de lista dentro de una tarjeta contenedora): `rounded-xl border border-primary/10 px-3 py-2`, ejemplo `gestion-estantes.component.html:91`.

### 3.2 Botones

| Variante | Clase completa | Ejemplo |
|---|---|---|
| Primario (envío de formulario, alto) | `flex h-12 [flex-1/w-full] items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold tracking-wider text-neutral uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50` | `gestion-estantes.component.html:55-60` |
| Primario pequeño ("Agregar", abre el formulario) | `rounded-lg bg-primary px-4 py-2 text-xs font-semibold tracking-wider text-neutral uppercase shadow-[0_4px_16px_rgba(35,12,0,0.08)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50` | `gestion-sitios-scraping.component.html:63-70` |
| Secundario / outline, alto ("Cancelar" en formulario) | `h-12 rounded-2xl border border-primary/20 px-4 text-sm font-semibold text-primary transition-opacity hover:opacity-90` | `gestion-estantes.component.html:62-69` |
| Secundario / outline, pequeño ("Editar" en fila de lista) | `rounded-lg border border-primary/20 px-3 py-1 text-xs font-semibold text-primary transition-opacity hover:opacity-90` | `gestion-estantes.component.html:94-99` |
| Peligro ("Eliminar") | `rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50` | `gestion-estantes.component.html:101-108` |

Notas:
- El botón primario grande no lleva sombra propia; el botón "Agregar" pequeño sí (`shadow-[0_4px_16px_rgba(35,12,0,0.08)]`), pese a ser visualmente más chico — desvío consistente en los tres CRUD que usan el patrón formulario oculto (`gestion-sitios-scraping`, `gestion-usuarios`, `gestion-descuentos-editoriales`).
- Todos los botones usan `transition-opacity hover:opacity-90` como único efecto de interacción — no hay cambios de color en hover.
- `disabled:cursor-not-allowed disabled:opacity-50` aparece en todo botón que se deshabilita durante una operación async (guardar, eliminar), pero no en botones que nunca se deshabilitan (ej. "Cancelar", "Editar").

### 3.3 Inputs de formulario reactivo

Input de texto/número/fecha estándar:

```html
class="w-full rounded-xl border border-primary/20 px-3 py-2 text-sm text-primary"
```

Ejemplo: `gestion-estantes.component.html:17-22`.

Cuando el control puede deshabilitarse (típicamente el campo de clave primaria durante edición: `dominio`, `email`, `editorial`), se agrega el sufijo `disabled:cursor-not-allowed disabled:opacity-50`:

```html
class="w-full rounded-xl border border-primary/20 px-3 py-2 text-sm text-primary disabled:cursor-not-allowed disabled:opacity-50"
```

Ejemplo: `gestion-sitios-scraping.component.html:85-91` (`dominio`, deshabilitado en modo edición).

`<select>` agrega `bg-white` a la misma clase base (necesario para que el navegador no aplique su propio fondo nativo): `w-full rounded-xl border border-primary/20 bg-white px-3 py-2 text-sm text-primary`, ejemplo `catalogar-libro.component.html:141-145`.

Checkbox: `h-4 w-4 rounded border-primary/20`, envuelto en `<label class="flex items-center gap-2 text-sm text-primary">`, ejemplo `gestion-sitios-scraping.component.html:128-131`.

Label de campo: `mb-1 block text-sm font-semibold text-primary`, ejemplo `gestion-estantes.component.html:16`.

Texto de ayuda bajo un campo (no es error, ej. "el email no se puede cambiar tras crear"): `mt-1 text-xs text-primary/60`, ejemplo `gestion-sitios-scraping.component.html:96`.

### 3.4 Mensajes de éxito / error

Error de validación a nivel de campo (bajo el input, cuando `control.invalid && control.touched`):

```html
<p class="mt-1 text-xs text-danger">El espacio es requerido.</p>
```
`gestion-estantes.component.html:23-25`.

Mensaje global de éxito/error tras una operación (`guardar`, `eliminar`, `exportar`) — hay dos variantes según el patrón de formulario del componente:

| Variante | Éxito | Error | Dónde aparece |
|---|---|---|---|
| Centrada (formulario siempre visible, un solo formulario en la página) | `text-center text-sm font-semibold text-tertiary` | `text-center text-sm text-danger` | `gestion-estantes.component.html:73-78`, `catalogar-libro.component.html:168-173`, `cambiar-estante.component.html:49-54`, `reportes-ventas.component.html:14-19` (sin `text-center`, pero mismo componente sin lista) |
| Alineada a la izquierda con `mb-3` (formulario oculto/CRUD con lista arriba) | `mb-3 text-sm font-semibold text-tertiary` | `mb-3 text-sm text-danger` | `gestion-sitios-scraping.component.html:13-18`, `gestion-usuarios.component.html:11-16`, `gestion-descuentos-editoriales.component.html:13-18` |

Error de carga de datos (`errorCarga()`, al fallar la petición inicial): `text-sm text-danger`, ejemplo `gestion-estantes.component.html:85`.

### 3.5 Estados vacío / carga

Estado vacío (lista sin elementos): `text-sm text-primary/70`, ejemplo `gestion-estantes.component.html:87` (`"Todavía no hay estantes registrados."`).

Estado de carga y estado vacío en el catálogo público (única página pública, sin autenticación) usan la variante centrada: `text-center text-primary/70` para carga/vacío y `text-center text-danger` para error, ejemplo `catalogo-publico.component.html:9-15`.

Placeholder de portada faltante (estado vacío de un dato individual, no de una lista): `flex aspect-[2/3] w-full items-center justify-center rounded-xl bg-neutral text-xs text-primary/60`, ejemplo `catalogo-publico.component.html:27-31`.

---

## 4. Patrón de formulario único crear/editar

Establecido a partir de `GestionSitiosScrapingComponent` y reutilizado en `GestionUsuariosComponent` y `GestionDescuentosEditorialesComponent`. Un mismo `FormGroup` reactivo sirve tanto para crear como para editar:

- Un signal `formularioVisible` controla si el formulario está desplegado — **oculto por defecto**, se muestra con un botón "Agregar" (`gestion-sitios-scraping.component.ts:55`, `gestion-usuarios.component.ts:51`, `gestion-descuentos-editoriales.component.ts:74`).
- Un signal con el nombre `[entidad]Editando[Clave]` (ej. `sitioEditandoDominio`, `usuarioEditandoEmail`, `editorialEditando`) es `null` mientras se crea y contiene la clave primaria de la fila mientras se edita.
- `agregar()`: limpia el signal de edición, resetea el formulario a valores vacíos, habilita el control de la clave primaria y despliega el formulario (`gestion-sitios-scraping.component.ts:73-80`).
- `editar(entidad)`: precarga el formulario con `setValue`, deshabilita el control de la clave primaria (no se puede cambiar tras crear el registro) y despliega el formulario (`gestion-sitios-scraping.component.ts:83-96`).
- `cancelarEdicion()`: limpia el signal de edición, resetea el formulario, vuelve a habilitar el control de la clave primaria y oculta el formulario, sin guardar cambios (`gestion-sitios-scraping.component.ts:99-104`).
- `guardar()`: decide entre `crear*` y `actualizar*` del servicio según si el signal de edición es `null`.
- En la plantilla, el título del formulario cambia dinámicamente: `{{ [entidad]Editando[Clave]() ? 'Editar X' : 'Nuevo X' }}` (ej. `gestion-sitios-scraping.component.html:79-81`), y bajo el input de la clave primaria deshabilitada aparece el texto de ayuda "no se puede cambiar tras crear" (`gestion-sitios-scraping.component.html:95-97`).

**Desvío documentado:** `GestionEstantesComponent` (el CRUD más antiguo del proyecto, primera tarea de administración) **no** implementa este patrón. Su formulario está siempre visible (no existe `formularioVisible`, ni método `agregar()`), y como `estanteId` es una clave generada automáticamente por el backend (no la ingresa el administrador), tampoco deshabilita ningún campo durante la edición — usa el mismo signal `estanteEditandoId` solo para distinguir el modo, pero sin ocultar/mostrar el formulario ni deshabilitar el control de clave.

---

## 5. Convenciones de espaciado y tamaño

| Convención | Clase | Ejemplo |
|---|---|---|
| Padding de página | `px-4 py-8` | `gestion-estantes.component.html:1` |
| Separación entre campos de un formulario | `flex flex-col gap-4` | `gestion-estantes.component.html:6` |
| Separación entre botones de una misma fila (submit + cancelar) | `flex gap-2` | `gestion-estantes.component.html:54` |
| Separación entre ítems de una lista | `flex flex-col gap-2` | `gestion-estantes.component.html:89` |
| Separación entre tarjetas de navegación (`admin-inicio`) | `flex flex-col gap-3` | `admin-inicio.component.html:8` |
| Separación entre dos campos en la misma fila (grid de 2 columnas) | `grid grid-cols-2 gap-4` | `catalogar-libro.component.html:95` |
| Radio de esquina — tarjetas y botones primarios | `rounded-2xl` | ver §3.1, §3.2 |
| Radio de esquina — inputs y filas de lista | `rounded-xl` | ver §3.3 |
| Radio de esquina — botones pequeños (Editar/Eliminar/Agregar) | `rounded-lg` | ver §3.2 |

---

## 6. Resumen de desvíos conocidos

Estos desvíos son reales en el código actual y se documentan tal como están, sin corregirlos:

1. **Login** no usa el contenedor de página estándar (`min-h-screen bg-surface px-4 py-8` + `mx-auto max-w-*`); usa un layout `fixed inset-0` centrado (`login.component.html:1`).
2. **Padding de tarjeta:** `p-6` en formularios, `p-4` en contenedores de lista/navegación, `p-3` en tarjetas de libro del catálogo público, `p-8` en la tarjeta de login.
3. **Sombra de tarjeta:** `rgba(35,12,0,0.08)` en todo el proyecto excepto la tarjeta de login, que usa `rgba(35,12,0,0.15)`.
4. **Botón "Agregar" pequeño** lleva sombra propia (`shadow-[0_4px_16px_rgba(35,12,0,0.08)]`); el botón primario grande de envío de formulario no lleva sombra.
5. **Mensajes de éxito/error globales:** centrados (`text-center`) en componentes con un único formulario siempre visible; alineados a la izquierda con `mb-3` en los CRUD con el patrón formulario oculto.
6. **`GestionEstantesComponent`** no implementa el patrón "formulario único crear/editar oculto por defecto" que sí siguen los tres CRUD posteriores (`gestion-sitios-scraping`, `gestion-usuarios`, `gestion-descuentos-editoriales`) — es la excepción por ser la tarea de administración más antigua del proyecto.
