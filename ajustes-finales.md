---
type: Note
_width: wide
---
# Ajustes finales

## Generales

- El espacio, mueble y ubicación donde se encuentran los libros, son datos independientes; es decir, el administrador debe crear, primero, un espacio (que hace referencia a espacios físicos en Le Tiende), luego los muebles (que hacen referencia a una biblioteca o mueble para libros) y, finalmente, la ubicación en dicho mueble (es decir, los lugares o estantes específicos para almacenar o exhibir libros en un mueble). Ver [Estantes](#-estantes).

## Usuarios no autenticados (clientes)

### Inicio - Catálogo público (título: "Catálogo librería - Le Tiende")

- El título del HTML no es consistente; estoy viendo **Inicio - Catálogo público** y, como título de la pestaña del navegador, me aparece 'Cuentos de amor - Le Tiende'.
- Luego del logo de Le Tiende, el título debe ser 'Catálogo Librería'.
- En la ficha de libro (`/libro/:libroID/`) se debe incluir la información de espacio, mueble y ubicación en campos independientes, no como una secuencia `{ESPACIO} - {MUEBLE} - {UBICACION}`.

### Autenticación

- Incluir un vínculo para regresar al **Inicio - Catálogo público**, en caso de que un usuario normal (cliente) haya hecho clic en **Ingresar** por error.

## Usuario autenticado (administrador o vendedor)

### Inicio - Catálogo público

- En la ficha de libro (`/libro/:libroID/`) debe aparecer un botón **Vender**; su funcionalidad se describe en [Venta de libro](#venta-de-libro).
- Cambiar el texto del vínculo **Mi cuenta** por **Gestionar**.

### Gestionar

- Añadir un vínculo para volver al **Inicio - Catálogo público**.
- Crear dos pestañas (*tabs*) para las dos funciones de la **Librería**:
  - **Catalogar**: formulario de catalogación (actualmente `/catalogar/`).
  - **Editar**: permite editar los libros ya catalogados, no únicamente cambiar el estante del libro.

#### Catalogar

Antes del panel con el formulario con los datos de un libro, se debe crear un panel con la ubicación del libro (eliminando el campo **Estante** actual). Esto facilita la catalogación, porque deben funcionar como dos entidades independientes, tal como se indica en el siguiente flujo:

1. Usuario selecciona el **Espacio** en el panel **Ubicación del libro**.
2. Usuario selecciona el **Mueble** en el panel **Ubicación del libro**.
3. Usuario selecciona la **Ubicación** en el panel **Ubicación del libro**.
4. Usuario busca el libro (flujo actual de búsqueda por barcode de ISBN, título, autor) y completa los datos.
5. Usuario hace clic en **CATALOGAR LIBRO**.
6. Sistema almacena el líbro con la info, PVP y ubicación del mismo.
7. Sistema limpia el formulario de información del libro, listo para el siguiente libro, pero **no cambia la info del panel Ubicación del libro**, de tal forma que el usuario puede continuar con el siguiente libro sin tener que volver a indicar su ubicación total de nuevo.

El procedimiento más común de catalogación será: el usuario tomará todos los libros de un mismo estante, los catalogará de forma secuencial, los dejará en el estante y continuará con el siguiente estante.

#### Editar

La lista de libros debe contar con un filtro por título, autor o ISBN (con lector de código de barras, como en **Catalogar**); cada libro en el resultado debe tener un botón con el texto **Editar**, y al hacer clic debe permitir editar los siguientes campos:

- Espacio
- Mueble
- Ubicación
- Número de ejemplares (inclusive si es 0)
- PVP
- Descuento de la editorial
- Botón de **ELIMINAR LIBRO** (solo para el usuario administrador).

Esto reemplaza completamente la funcionalidad **Cambiar estante**.

## Administrador

### Administación

#### Estantes

Esta sección debe tener tres pestañas, con los siguientes elementos:

- **Espacios:**
  - Campo para ingresar el nombre del **Espacio**.
  - Botón **CREAR ESPACIO**.
  - Lista de **Espacios** existentes con botón **Editar**.
- **Muebles:**
  - Desplegable con **Espacios** disponibles.
  - Campo para ingresar el nombre del **Mueble**.
  - Botón **CREAR MUEBLE**.
  - Lista de **Espacios/Muebles** existentes con botón **Editar**.
- **Ubicaciones:**
  - Desplegable con **Muebles** disponibles.
  - Campo para ingresar el nombre de la **Ubicación**.
  - Botón **CREAR UBICACIÓN**.
  - Lista de **Espacios/Muebles/Ubicaciones** existentes con botón **Editar**.

Al editar cada componente, el usuario podrá:

- **Espacio**:
  - Cambiar el nombre del **Espacio**.
- **Mueble**:
  - Cambiar, desde un desplegable con los disponibles, el **Espacio**.
  - Cambiar el nombre del **Mueble**.
- **Ubicación**:
  - Cambiar, desde un desplegable con los disponibles, el **Espacio**.
  - Cambiar, desde un desplegable con los disponibles, dependiente del anterior desplegable, el **Mueble**.
  - Cambiar el nombre de la **Ubicación**.

Si el usuario cambia el nombre de un elemento padre (**Espacio** o **Mueble**), sus hijos (**Mueble** o **Ubicación**) seguirán perteneciéndole.

#### Usuarios

Sin ajustes.

#### Editoriales

Sin ajustes de UX/UI, solo una nota: el porcentaje de descuento de editorial determinado en esta sección debe aparecer en el formulario de catalogación de libros, en caso de que el nombre de la editorial coincida.

#### **Sitios de scraping**

Sin cambios

#### Reportes

Se deben generar dos tipos de reporte:

- Inventario:
  - ISBN
  - Título
  - Autor
  - Editorial
  - PVP
  - Descuento editorial
  - Cantidad
  - Espacio
  - Mueble
  - Ubicación
- Ventas: como está actualmente.

## Funcionalidades adicionales

### Inicio - Catálogo público

#### Filtrado por ubicación / mueble

Un usuario no autenticado también puede filtrar por espacio / mueble. Así, los usuarios que estén físicamente en la librería pueden indicar el espacio (Sala Principal, Sala VIP, etc.) y el mueble (Biblioteca 1, Biblioteca 2, etc.), y podrán ver un listado de los libros que se encuentran en las ubicaciones del mueble; estos dos filtros deben ser acumulativos. También debe ser posible escanear un código QR, que tendrá cada mueble, para hacer este filtrado más rápido.

#### Venta de libro

Cuando un usuario autenticado (administrador o vendedor) hace clic sobre el botón **Vender**, se abre un diálogo con:

- El número de ejemplares que se van a vender; por defecto, uno.
- El descuento de venta (no confundir con el **Descuento de editorial**); por defecto, 0%.
- Botón **Cancelar**.
- Botón **Confirmar**.

Al confirmar la venta, se reduce la disponibilidad de ejemplares del catálogo.

**NOTA IMPORTANTE:** si el número de ejemplares de un libro es 0, no debe aparecer en catálogo, ni en las búsquedas públicas, ni está disponible para la venta.

---

## Decisiones técnicas confirmadas (2026-07-23)

Este documento tenía algunos vacíos frente al código real o frente a decisiones ya tomadas — se resolvieron con el usuario antes de tocar `PRD.md`/`TODO.md`:

1. **Forma de pago en el diálogo "Vender":** el documento no la menciona, pero el modelo de `Venta` la exige (sin default). Se agrega al diálogo como campo obligatorio, mismo enum ya usado en Reportes (efectivo/tarjeta/transferencia/nequi/daviplata).
2. **Cantidad > 1 en una venta:** `POST /api/ventas` hoy vende EXACTAMENTE 1 ejemplar por llamada (sin campo `cantidad`). Se extiende el backend para aceptar `cantidad` y crear **1 solo registro de Venta** que representa N ejemplares — los reportes muestran 1 fila por transacción de venta, no N.
3. **Ficha de un libro agotado (`cantidadDisponible = 0`):** la ficha (`/libro/:bookId`) **sigue siendo accesible** (decisión ya tomada al construirla, para no romper enlaces directos) — solo se oculta el botón "Vender" y se indica que no hay ejemplares disponibles. Lo que la nota exige ("no debe aparecer en catálogo, ni en las búsquedas") ya lo cumple el LISTADO/BÚSQUEDA público, que sigue excluyendo libros con `cantidadDisponible = 0`.
4. **Datos de prueba de `babel-estantes` en `staging`:** se pierden sin problema al migrar al esquema nuevo (Espacios/Muebles/Ubicaciones) — se resiembran desde cero. No hay datos de producción todavía.
5. **Alcance de "QR por mueble":** solo la URL filtrable del catálogo público (ej. `/?espacio=X&mueble=Y`). Generar/imprimir la imagen del código QR queda fuera de esta iniciativa — cualquier generador externo apuntando a esa URL funciona.

## Bug real encontrado durante la revisión

El punto "El título del HTML no es consistente" no es solo una inconsistencia de copy — es un bug real: `Title` de Angular es un servicio singleton, y `LibroDetalleComponent` (PR #51) lo sobreescribe con el título del libro visitado, pero `CatalogoPublicoComponent` nunca lo resetea al volver a `/`. Por eso el título de pestaña "se queda pegado" al último libro visitado. Se corrige en la Tarea A de abajo.

## Backlog ordenado de implementación

Alcance completo de este documento, roto en tareas atómicas en orden de dependencia (una tarea puede necesitar que la anterior ya esté fusionada). `TODO.md` mantiene siempre las primeras 2 como Tarea 1/Tarea 2 activas; al cerrar una, se promueve la siguiente de esta lista.

- [x] **Tarea A — Fixes rápidos del catálogo público** (PR #53 fusionado): corrige el bug del título de pestaña (`Title` sin resetear), cambia el texto tras el logo a "Catálogo Librería", agrega vínculo "volver al inicio" en `/login`.
- [x] **Tarea B — Espacios/Muebles/Ubicaciones** (PR #54 fusionado): 3 tablas DynamoDB nuevas + 3 CRUD backend (`server/api/handlers/ubicacion-fisica.ts`, escritura solo administrador, lectura pública) + pantalla `/admin/ubicaciones` (ruta nueva, reemplaza a `/admin/estantes` — no se mantuvo la misma ruta como se planeó originalmente, se prefirió un nombre que refleje el contenido real) con 3 pestañas y cascada Espacio→Mueble en Ubicaciones. **Deliberadamente NO se tocó `babel-estantes`/`EstantesService`/`estantes.ts`**: `CatalogarLibroComponent`/`CambiarEstanteComponent` siguen dependiendo de ellos hasta la Tarea C (ver TODO.md). Fix post-merge: la descripción de la función `espacios` en `serverless.yml` excedía el límite de 256 caracteres de CloudFormation y hacía fallar el deploy — acortada.
- [x] **Tarea C — Migrar `Libro.estanteId` → `Libro.ubicacionId`** (PR #56 fusionado, con fix adicional post-merge): `POST /api/libros`, el modelo `Libro` (frontend/backend) y la ficha de libro ya usan `ubicacionId`, resolviendo y mostrando Espacio/Mueble/Ubicación como **campos independientes** (no concatenados) — cierra el hallazgo del documento. `handlerCambiarEstante`/`CambiarEstanteComponent`/ruta `/libros/:bookId/estante` no se eliminaron: se **renombraron** a `handlerCambiarUbicacion`/`CambiarUbicacionComponent`/`/libros/:bookId/ubicacion` como placeholder mínimo (mismo flujo, apuntando al modelo nuevo) hasta que la Tarea E los reemplace de verdad con la pestaña "Editar" — decisión tomada en la propia tarea para no dejar al vendedor sin forma de reubicar un libro. **Fix post-merge (PR #56, mismo PR):** libros catalogados antes de la migración no tienen `ubicacionId` — `resolverUbicacion` ahora devuelve `null` de inmediato en ese caso en vez de lanzar (antes causaba `500` en `GET /api/libros/:bookId`). `EstantesService`/`estantes.ts`/`babel-estantes`/`Estante` eliminados por completo.
- [x] **Tarea D — Vender desde la ficha** (PR #57 fusionado): `POST /api/ventas` acepta `cantidad` (1 solo registro de `Venta` representa N ejemplares, decremento atómico condicional vía `decrementarPorCantidadSiSuficiente`); botón "Vender" en la ficha (vendedor/administrador autenticado, oculto sin ejemplares) con diálogo (cantidad, descuento de venta, forma de pago, cancelar/confirmar). `precioFinal`/`utilidad` representan el TOTAL de la transacción. Nuevo `VentaService.registrarVenta(...)` (servicio separado de `VentasService`, que solo cubre reportes).
- [x] **Tarea E — Área "Gestionar"** (PR #60 fusionado): nueva ruta `/gestionar` con 2 pestañas (`GestionarComponent`) — **Catalogar** reutiliza `CatalogarLibroComponent` (movido de `features/catalogar/` a `features/gestionar/`) con el panel de ubicación persistente entre catalogaciones y autocompletado de `porcentajeDescuentoEditorial`; **Editar** (`EditarLibroComponent`) lista el inventario completo (`GET /api/libros/inventario`, nuevo — a diferencia del catálogo público, incluye libros con `cantidadDisponible = 0`) con filtro por título/autor/ISBN, botón "Editar" → formulario de Espacio/Mueble/Ubicación/cantidad/PVP/descuento, y "ELIMINAR LIBRO" solo para `administrador`. Backend: `PUT`/`DELETE /api/libros/:bookId` (nuevos) reemplazan a `handlerCambiarUbicacion`. Header: "Mi cuenta" → "Gestionar" apuntando a `/gestionar`; `ListaLibrosCatalogadosComponent`, `CambiarUbicacionComponent`, `/libros` y `/libros/:bookId/ubicacion` eliminados, junto con `AuthGuard` (sin más usos tras retirar `/libros`). De paso, `GET /api/editoriales-descuentos` se abrió a `vendedor` (antes exclusivo de `administrador`) para que el autocompletado funcione también desde Catalogar.
- [x] **Tarea F — Filtrado público por ubicación** (PR #62 fusionado): `CatalogoPublicoComponent` agrega 2 `<select>` (Espacio, Mueble dependiente del Espacio elegido) resolviendo `Libro.ubicacionId → Ubicacion.muebleId → Mueble.espacioId` en el cliente (`UbicacionFisicaService`, endpoints públicos de la Tarea B, sin tocar `GET /api/libros`), acumulativos entre sí y con la búsqueda de texto ya existente. Soporta query params `?espacio=&mueble=` en ambas direcciones (pre-filtra al entrar, habilitando el caso de uso QR; cambiar un `<select>` actualiza la URL con `replaceUrl`). Bug real corregido de paso: `[value]` en un `<select>` nativo sin Reactive Forms no selecciona la opción si las `<option>` del `@for` aún no existían en el DOM al aplicar el binding — reemplazado por `[selected]` por opción. Verificado en vivo por el usuario en `staging`.
- [x] **Tarea G — Reporte de Inventario** (PR #63 fusionado): nuevo `GET /api/libros/exportar` (`handlerExportarInventario`, administrador exclusivo) genera un `.xlsx` con ISBN/Título/Autor/Editorial/PVP/Descuento editorial/Cantidad (`cantidadDisponible`)/Espacio/Mueble/Ubicación — resuelve la jerarquía completa con 3 `escanearTodo` en paralelo + `Map` en memoria (no `GetItem` por libro). Segunda tarjeta "Reporte de inventario" en `ReportesVentasComponent` (`/admin/reportes`), junto al reporte de ventas ya existente, con su propio estado de carga/error/éxito. Verificado en vivo por el usuario en `staging`.

**Cierra el backlog completo de `ajustes-finales.md` (Tareas A–G).** A partir de aquí se retoma el plan de modo offline y la preparación del primer despliegue a producción (ver `TODO.md`) — el usuario pidió primero una ronda de pruebas manuales de flujos completos en `staging` antes de detallar esas dos tareas finales, para capturar cualquier ajuste pendiente antes de tocar ese terreno.
