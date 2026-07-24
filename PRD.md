# PRD — Babel

Documento de requerimientos de producto para **Babel**, la aplicación de catalogación, ubicación e inventario de ventas de la librería del centro cultural **Le Tiende**.

---

## 1. Visión del producto

| Campo | Detalle |
|---|---|
| Nombre | Babel |
| Tipo de producto | Aplicación web progresiva (PWA) para catalogación, ubicación y venta de libros, con catálogo público de consulta |
| Público objetivo | Vendedores y administrador(es) de Le Tiende (uso interno); público general (consulta del catálogo, sin cuenta) |
| Idiomas | Español (Colombia) |
| URL principal | https://babel.letiende.co |
| Proyecto hermano de referencia | Comandante (`comandante.letiende.co`) — misma filosofía visual y de flujo de desarrollo |

---

## 2. Contexto y problema que resuelve

La librería de Le Tiende tiene un inventario físico de más de 3.000 libros sin catalogar digitalmente: no existe un registro centralizado de qué libros hay, dónde están ubicados dentro del espacio, cuál es su precio de venta al público, ni cuáles ya se vendieron. Esto genera tres problemas concretos:

1. **Catalogación manual costosa:** buscar cada dato de un libro (autor, editorial, precio) a mano es lento; con 3.000+ ejemplares, cualquier fricción en el flujo se multiplica de forma crítica.
2. **Pérdida de trazabilidad de ventas:** sin un registro digital, no hay forma confiable de saber qué se vendió, cuándo, con qué medio de pago, ni calcular utilidad real por libro.
3. **Sin visibilidad para el cliente:** los visitantes no tienen forma de saber, antes de ir físicamente, si un libro está disponible, a qué precio y en qué parte de la librería se encuentra.

Babel resuelve estos tres problemas con un flujo de catalogación asistido (que minimiza la captura manual de datos), un registro de ventas de un toque, reportes financieros para el administrador, y un catálogo público de solo lectura.

---

## 3. Usuarios y audiencias

| Perfil | Necesidades |
|---|---|
| **Vendedor** | Catalogar libros rápido (meta: minimizar segundos por libro dado el volumen de 3.000+), editar un libro ya catalogado (ubicación, cantidad, PVP, descuento editorial), registrar una venta en pocos toques desde el celular. |
| **Administrador** | Todo lo del vendedor, más: ver y descargar reportes de ventas e inventario, gestionar usuarios, definir descuentos por editorial, crear/editar/borrar espacios/muebles/ubicaciones, eliminar libros catalogados por error. |
| **Visitante público** | Consultar el catálogo completo sin necesidad de crear cuenta: buscar por nombre, autor o ISBN, o filtrar por espacio/mueble (incluido vía código QR); ver precio y ubicación física dentro de la librería en la ficha de cada libro. |

---

## 4. Objetivos

| Métrica de éxito | Estado |
|---|---|
| Catalogar el inventario inicial de 3.000+ libros en el menor tiempo posible por unidad | Pendiente |
| Flujo de catalogación con captura automática de datos (ISBN → metadatos → precio) en la mayoría de los casos, sin digitación manual | Pendiente |
| Registro de venta ejecutable en menos de 30 segundos desde que se escanea el libro | Pendiente |
| Costo de infraestructura mensual de $0 o el mínimo posible dentro de la capa gratuita de AWS/Firebase | Pendiente |
| Catálogo público consultable sin autenticación, con buena indexabilidad (SSR) | Pendiente |
| Reportes de ventas exportables en XLSX filtrados por fecha, PVP, utilidad, costo, editorial o forma de pago | Pendiente |

---

## 5. Funcionalidades actuales

> "Actuales" en el sentido de alcance definido para la primera versión del producto (aún no implementadas — proyecto en fase de arranque).

### 5.1 Autenticación

El usuario inicia sesión con su cuenta de Google. El sistema determina automáticamente si es **administrador** o **vendedor** según su rol registrado.

```
Usuario → Botón "Ingresar con Google"
   → Selección de cuenta Google
   → Sistema valida el correo contra el registro de usuarios
        ├─ Rol = Administrador → Redirige a panel completo (venta + catalogación + configuración + reportes)
        └─ Rol = Vendedor      → Redirige a panel operativo (venta + catalogación)
   → Correo no registrado → Acceso denegado, mensaje de contacto con el administrador
```

**Sobre la cuenta de Google:** Babel reutiliza el mismo inicio de sesión con Google que ya usan los usuarios de Comandante — no es necesario crear una cuenta nueva. Sin embargo, tener acceso a Comandante no otorga automáticamente ningún permiso en Babel (ni viceversa): el rol de administrador o vendedor se administra por separado en cada aplicación, y un correo debe estar registrado explícitamente en Babel para poder usarla.

### 5.2 Catalogación de un libro

Flujo crítico del sistema — debe ser lo más rápido posible dado el volumen de 3.000+ libros a catalogar. Vive dentro del área **Gestionar** (pestaña **Catalogar**), accesible a vendedor y administrador.

```
Vendedor → Panel "Ubicación del libro" (se completa UNA VEZ, no por cada libro):
   → Selecciona el Espacio de una lista
   → Selecciona el Mueble de una lista (filtrado por el Espacio elegido)
   → Selecciona la Ubicación de una lista (filtrada por el Mueble elegido)

→ Vendedor → Escanea código de barras con la cámara
   ├─ Código detectado → obtiene ISBN
   └─ Sin código de barras → ingresa ISBN manualmente
        └─ Sin ISBN → busca por título/autor y elige el libro exacto de una lista de candidatos (portada, título, autor, editorial, ISBN de cada uno)

→ Sistema busca los datos del libro (título, autor, editorial, portada) por ISBN o por título/autor
   ├─ 1.º api.letiende.co (proxy de Google Books), con un reintento ante fallas transitorias
   ├─ 2.º si faltan datos: scraping de los sitios autorizados para «info» (lista única, por orden de prioridad)
   ├─ Datos encontrados → se pre-cargan (siempre editables por el vendedor; al elegir un candidato de la búsqueda por título/autor, se sobrescribe cualquier dato ya escrito, porque es una elección explícita del vendedor)
   └─ Datos no encontrados → el vendedor los completa manualmente

→ Sistema busca el precio de venta al público (PVP) por ISBN o por título/autor
   ├─ Scraping de los sitios autorizados para «pvp» (misma lista única, por orden de prioridad), precio en pesos colombianos
   ├─ Encontrado → se pre-carga como sugerencia editable (el backend valida que sea un número positivo dentro de un rango razonable)
   └─ No encontrado → el vendedor ingresa el valor manualmente

→ Vendedor confirma/ajusta el % de descuento editorial — si el nombre de la editorial resuelta coincide con una ya configurada en §5.6, el sistema pre-carga automáticamente su porcentaje por defecto (siempre editable); si el libro es propiedad de Le Tiende y no está en consignación, el descuento editorial es 100%
→ Vendedor indica el número de ejemplares disponibles
→ Vendedor presiona "CATALOGAR LIBRO"
→ Sistema guarda el libro con su info, PVP y la ubicación ya seleccionada
→ Sistema limpia el formulario de datos del libro para el siguiente — el panel "Ubicación del libro" NO se limpia, así el vendedor cataloga en serie todos los libros de un mismo estante sin repetir la selección de ubicación
```

**Sobre el descuento editorial:** es el porcentaje que la editorial reconoce a Le Tiende sobre el PVP en los libros que deja en consignación — no es un descuento al público, sino el margen que le queda a la librería. El valor típico en el contexto colombiano es 35% (PVP $100.000 → la editorial cobra $65.000, Le Tiende retiene $35.000 de utilidad); el administrador puede configurar modelos distintos para editoriales independientes (ver §5.6). Cuando el libro es propiedad de Le Tiende (no está en consignación con ninguna editorial), el descuento editorial es 100%: no hay costo asociado y toda la venta es utilidad de la librería. Este porcentaje es independiente del descuento que el vendedor pueda aplicar al momento de la venta (ver §5.4).

### 5.3 Edición de un libro catalogado

Reemplaza por completo la funcionalidad anterior de "cambio de estante": ahora se puede editar cualquier atributo físico/comercial de un libro ya catalogado, no solo su ubicación. Vive dentro del área **Gestionar** (pestaña **Editar**), accesible a vendedor y administrador.

```
Vendedor/Administrador → Busca el libro en la lista de catalogados (filtro por título, autor o ISBN — incluido lector de código de barras)
   → Presiona "Editar" sobre el libro encontrado
   → Puede modificar: Espacio, Mueble, Ubicación, número de ejemplares (incluso 0), PVP, % de descuento editorial
   → (Solo administrador) Puede presionar "ELIMINAR LIBRO" para borrarlo por completo del sistema
   → Sistema guarda los cambios
```

Un libro cuya cantidad de ejemplares queda en 0 deja de aparecer en el catálogo público, en las búsquedas públicas y no está disponible para la venta (ver §5.4) — pero su ficha (`/libro/:bookId`) sigue siendo accesible directamente (ej. por un enlace ya compartido), mostrando que no hay ejemplares disponibles, sin el botón "Vender".

### 5.4 Registro de venta

La venta se registra desde la **ficha del libro** (`/libro/:bookId`, §5.7): es la misma pantalla que ve cualquier visitante, con un botón adicional visible solo para vendedor/administrador autenticado. Encontrar el libro (por escaneo de ISBN, búsqueda en el catálogo público, o navegación directa) y venderlo son un solo flujo, no dos pantallas separadas.

```
Vendedor → Llega a la ficha del libro (escaneando su ISBN, buscándolo en el catálogo, o entrando directo a su URL)
   → Presiona el botón "Vender" (oculto si no quedan ejemplares disponibles)
   → Diálogo:
        - Número de ejemplares a vender (1 por defecto)
        - % de descuento de venta (0% por defecto)
        - Forma de pago: Efectivo / Tarjeta / Transferencia / Nequi / Daviplata
        - Botones Cancelar / Confirmar
   → Vendedor presiona "Confirmar"
→ Sistema registra la venta (guarda forma de pago, descuento aplicado y fecha/hora) y reduce la disponibilidad de ejemplares en la cantidad vendida
→ Si la disponibilidad llega a 0, el libro deja de aparecer en el catálogo público y en las búsquedas (§5.3)
```

**Sobre el descuento de venta:** es un descuento discrecional, distinto e independiente del descuento editorial (§5.2), que el vendedor acuerda con el comprador al momento de la venta — típicamente para rotar catálogo o al negociar libros que son propiedad de Le Tiende (sin descuento editorial de por medio). Reduce el precio final que paga el cliente; no modifica el costo del libro ni el descuento editorial ya definido al catalogarlo.

### 5.5 Reportes (solo administrador)

El administrador visualiza y descarga en formato XLSX dos tipos de reporte, ambos desde la misma sección:

- **Ventas:** los libros vendidos, filtrados u ordenados por rango de fecha de venta, PVP, utilidad, costo, editorial o forma de pago.
- **Inventario:** el catálogo completo con ISBN, título, autor, editorial, PVP, % de descuento editorial, cantidad de ejemplares disponibles, espacio, mueble y ubicación de cada libro.

### 5.6 Configuración de la aplicación (solo administrador)

- Gestión de usuarios: crear, editar, borrar vendedores y administradores.
- Gestión de descuentos por editorial: definir, por editorial, el porcentaje por defecto y una lista de porcentajes alternativos disponibles (afecta el cálculo de costo y utilidad de cada libro catalogado con esa editorial). El valor 100% (libro propio de Le Tiende, sin consignación) está siempre disponible como opción para cualquier libro, independientemente de su editorial. Cuando el nombre de la editorial coincide con el de un libro en catalogación, su porcentaje por defecto se pre-carga automáticamente en el formulario de catalogación (§5.2).
- **Gestión de ubicación física:** tres entidades independientes y jerárquicas, cada una con su propio CRUD:
  - **Espacio** — un área física de la librería (ej. "Sala principal", "Exhibidor terraza"). Se crea primero, sin depender de nada más.
  - **Mueble** — una biblioteca o mueble para libros (ej. "Biblioteca 1"), pertenece a un Espacio.
  - **Ubicación** — el lugar preciso dentro de un Mueble donde se guarda o exhibe un libro (ej. "Estante 1"), pertenece a un Mueble.
  
  Un libro se ubica siempre en una **Ubicación** puntual, que ya implica su Mueble y Espacio. Renombrar un Espacio o un Mueble no afecta la pertenencia de sus Muebles/Ubicaciones ya creados — la relación es por identificador, no por nombre.
- Gestión de sitios de scraping (fuentes automáticas de datos y precio): una lista única de sitios de librerías donde el sistema busca información del libro y/o su PVP por ISBN o por título/autor. Por cada sitio se define un nombre, su URL y dos permisos independientes: si está autorizado para extraer datos bibliográficos (`info`) y si está autorizado para extraer el precio (`pvp`) — un sitio puede servir para uno, ambos o ninguno. Reemplaza el antiguo modelo de dos listas separadas (autorizados vs. prohibidos). Por seguridad, aunque un sitio esté en la lista, el sistema solo hace peticiones a dominios públicos válidos (nunca a direcciones internas).

### 5.7 Catálogo público (sin autenticación)

Cualquier persona puede ver el catálogo completo y buscar/filtrar por nombre, autor o ISBN, y también filtrar por ubicación física — Espacio y Mueble, de forma acumulativa entre sí y con la búsqueda de texto — útil para un visitante que está físicamente en la librería y quiere ver solo los libros de la sala o el mueble frente a él. Este filtro por ubicación también se puede activar directamente por URL, lo que permite que cada Mueble tenga asociado un código QR que, al escanearlo, abra el catálogo ya filtrado a ese mueble (la generación/impresión del código QR en sí es un proceso externo a Babel).

Cada libro tiene una **ficha propia** (`/libro/:bookId`) con su información completa — título, autor, editorial, PVP, portada y su Espacio/Mueble/Ubicación como datos independientes (no como un solo texto combinado) — indexable y enlazable directamente. Un usuario autenticado (vendedor o administrador) ve además, en esa misma ficha, un botón para vender el libro (§5.4).

---

## 6. Roadmap

| Feature | Prioridad |
|---|---|
| Autenticación con Google (Firebase Auth) + resolución de rol | Alta |
| Flujo de catalogación completo (escaneo/búsqueda → metadatos → precio → ubicación) | Alta |
| Registro de venta desde la ficha del libro | Alta |
| Catálogo público de consulta (SSR, sin autenticación) + ficha de libro | Alta |
| Obtención automática de PVP y metadatos por scraping (por ISBN o título/autor, sobre una lista de sitios administrable) | Alta |
| Gestión de ubicación física jerárquica (Espacio → Mueble → Ubicación, CRUD) | Alta |
| Edición de libros catalogados (ubicación, cantidad, PVP, descuento editorial; eliminar) | Alta |
| Filtrado del catálogo público por ubicación (espacio/mueble), navegable por URL/QR | Media |
| Configuración de sitios de scraping (CRUD, lista única con permisos info/pvp) | Media |
| Configuración de descuentos de editorial (CRUD, con autocompletado en catalogación) | Media |
| Gestión de usuarios (CRUD) | Media |
| Reportes de ventas + inventario, exportación XLSX | Media |
| Modo offline / cola de sincronización para catalogación sin señal | Baja — bloqueado hasta cerrar los ajustes de esta sección (ver `TODO.md`) |
| Primer despliegue a producción | Baja — bloqueado hasta cerrar los ajustes de esta sección (ver `TODO.md`) |
| Empaquetado nativo (Capacitor) si el uso como PWA resulta insuficiente | Baja, fuera del alcance actual (`CLAUDE.md` §2) |

---

## 7. Casos de uso

| Actor | Acción | Resultado esperado |
|---|---|---|
| Vendedor | Cataloga varios libros seguidos, todos del mismo estante físico | Selecciona Espacio/Mueble/Ubicación una sola vez; el panel de ubicación no se limpia entre libros catalogados |
| Vendedor | Escanea un libro con código de barras legible | El sistema pre-completa autor, portada, editorial y PVP; el vendedor solo confirma cantidad |
| Vendedor | Escanea un libro sin metadatos disponibles en ninguna fuente | El sistema le permite ingresar todos los datos manualmente sin bloquear el flujo |
| Vendedor | No tiene el ISBN a mano, busca por título/autor | El sistema muestra una lista de candidatos (portada, título, autor, editorial, ISBN); al elegir uno, se pre-cargan todos sus datos |
| Vendedor | Llega a la ficha de un libro (por escaneo, búsqueda o navegación directa) y lo vende | El diálogo "Vender" le permite ajustar cantidad, descuento de venta y forma de pago; al confirmar, se reduce la disponibilidad de ejemplares |
| Vendedor | Cataloga un libro propiedad de Le Tiende, sin consignación | El sistema permite marcar el descuento editorial en 100%, sin costo asociado |
| Vendedor/Administrador | Edita un libro ya catalogado (ubicación, cantidad, PVP o descuento editorial) | Los cambios quedan reflejados de inmediato en el catálogo público |
| Administrador | Elimina un libro catalogado por error | El libro deja de existir en el sistema por completo |
| Administrador | Cambia el descuento por defecto de una editorial | Los libros nuevos catalogados de esa editorial usan el nuevo % para calcular costo/utilidad (y se pre-cargan automáticamente si el nombre coincide); los ya vendidos conservan el costo/utilidad que tenían al momento de la venta |
| Administrador | Descarga el reporte de ventas del último mes filtrado por forma de pago | Recibe un archivo XLSX con los libros vendidos que cumplen el filtro |
| Administrador | Descarga el reporte de inventario completo | Recibe un archivo XLSX con todos los libros catalogados, su ubicación y sus datos comerciales |
| Administrador | Crea un nuevo usuario vendedor | El nuevo usuario puede iniciar sesión con su cuenta Google y acceder al área Gestionar |
| Visitante público | Busca un libro por nombre desde su celular, sin cuenta | Ve el PVP y, en la ficha del libro, su ubicación física (Espacio/Mueble/Ubicación) dentro de la librería, si está disponible |
| Visitante público | Está físicamente en la librería, frente a un mueble con código QR | Al escanearlo, ve el catálogo ya filtrado a los libros ubicados en ese mueble |
| Visitante público | Hace clic en "Ingresar" por error, sin ser vendedor/administrador | Encuentra un vínculo visible para volver al catálogo público sin necesidad de iniciar sesión |

---

## 8. Requisitos no funcionales

- **Performance:** el flujo de catalogación es la ruta crítica del producto — debe optimizarse para el menor número de pasos e interacciones posible, dado el volumen de 3.000+ libros a catalogar por el equipo.
- **SEO:** el catálogo público debe ser indexable por buscadores; se requiere renderizado del lado del servidor (SSR) para las páginas de catálogo y ficha de libro.
- **Seguridad:** solo usuarios autenticados y con rol adecuado pueden catalogar, editar o vender; el catálogo público es de solo lectura y no requiere cuenta.
- **Accesibilidad:** áreas táctiles mínimas de 48×48 px en la interfaz móvil (heredado del estándar de Comandante), contraste de color acorde a WCAG AA como mínimo.
- **Costo:** la infraestructura (cómputo, base de datos, autenticación) debe mantenerse en $0 o el valor más bajo posible dentro de la capa gratuita de los proveedores usados.
- **Disponibilidad del catálogo público:** debe permanecer accesible incluso si el flujo de catalogación/venta está en mantenimiento.

---

## 9. Restricciones y decisiones de diseño

- La infraestructura debe apuntar a costo $0; esto condiciona decisiones técnicas (ver tech-specs.md) como el tipo de scraping (sin navegador headless), el modo de capacidad de la base de datos y el uso de servicios siempre gratuitos de AWS.
- La aplicación es una PWA responsive, no una app nativa empaquetada, en el alcance actual.
- La API en `https://api.letiende.co` ya existe y es compartida entre aplicaciones de Le Tiende; Babel la consume para resolver metadatos de libros a partir del ISBN, pero no la construye ni la mantiene dentro de este repositorio.
- La búsqueda automática de datos y de precio en sitios web se gobierna con una lista única de sitios administrable por el administrador, donde cada sitio declara por separado si está autorizado para extraer información del libro (`info`) y/o su precio (`pvp`). Reemplaza el modelo anterior de dos listas separadas (autorizados vs. prohibidos). Por seguridad, el sistema solo hace peticiones salientes a dominios públicos válidos, nunca a direcciones internas, con independencia de lo que contenga la lista.
- La filosofía visual (UX/UI) y el flujo de CI/CD (GitHub Actions) deben ser consistentes con los del proyecto Comandante.
- Babel comparte el inicio de sesión de Google con Comandante (mismo proyecto de autenticación): un usuario puede tener cuenta en ambas aplicaciones sin registrarse dos veces, pero el rol (administrador/vendedor) se define de forma independiente en cada aplicación y en su propia base de datos — administrar usuarios en una no afecta a la otra.
- La ubicación física es un modelo jerárquico de tres entidades independientes (Espacio → Mueble → Ubicación, §5.6), relacionadas por identificador, no por nombre: renombrar un Espacio o Mueble nunca desvincula a sus hijos ya creados.
- El modo offline/cola de sincronización y el primer despliegue a producción quedan deliberadamente pospuestos hasta cerrar el conjunto de ajustes descrito en `ajustes-finales.md` (decisión del usuario, 2026-07-23) — ver el orden de prioridad vigente en `TODO.md`.

---

## 10. Glosario de negocio

| Término | Definición |
|---|---|
| **PVP** | Precio de Venta al Público del libro. |
| **ISBN** | Código identificador único de un libro (International Standard Book Number), normalmente impreso como código de barras. |
| **Catalogar** | Registrar un libro en el sistema con sus datos, precio, cantidad de ejemplares y ubicación física. |
| **Espacio** | Nivel más general de la ubicación física — un área de la librería (ej. "Sala principal"). Se crea de forma independiente, sin depender de ningún otro elemento. |
| **Mueble** | Nivel intermedio de la ubicación física — una biblioteca o mueble para libros (ej. "Biblioteca 1"), pertenece a un Espacio. |
| **Ubicación** | Nivel más específico de la ubicación física — el lugar preciso dentro de un Mueble donde se guarda o exhibe un libro (ej. "Estante 1"), pertenece a un Mueble. Es el dato que se le asigna directamente a cada libro catalogado (reemplaza el concepto anterior de "Estante" como una sola entidad). |
| **Ficha de libro** | Página propia de un libro (`/libro/:bookId`), pública y enlazable, con toda su información — incluida su ubicación física como campos independientes — y, para un usuario autenticado, el botón para venderlo. |
| **Gestionar** | Área de la aplicación para vendedor y administrador con las dos operaciones del día a día: Catalogar y Editar libros ya catalogados. Distinta de la sección de Administración, exclusiva del administrador. |
| **Lista de sitios de scraping** | Lista única de sitios web (librerías) administrable por el administrador donde el sistema busca automáticamente los datos y/o el precio de un libro por ISBN. Cada sitio declara dos permisos independientes: `info` (extraer título/autor/editorial/portada) y `pvp` (extraer el precio). Reemplaza el par lista blanca / lista negra. |
| **Permisos `info` / `pvp`** | Las dos banderas booleanas de cada sitio de la lista de scraping: `info` autoriza extraer datos bibliográficos; `pvp` autoriza extraer el precio. Un sitio con ambos en falso queda prohibido para todo. |
| **Descuento editorial** | Porcentaje del PVP que la editorial reconoce a Le Tiende como margen en los libros que deja en consignación (típicamente 35%). Determina el costo (`PVP × (1 − % descuento editorial)`) y la utilidad de catalogación (`PVP × % descuento editorial`) de cada libro. Es 100% cuando el libro es propiedad de Le Tiende y no está en consignación con ninguna editorial. No debe confundirse con el descuento de venta. |
| **Descuento de venta** | Descuento discrecional que el vendedor aplica al precio final al momento de vender un libro, acordado con el comprador (0% por defecto). Es independiente del descuento editorial: reduce lo que paga el cliente, no el costo del libro. |
| **Consignación** | Modalidad en la que una editorial deja libros en Le Tiende para la venta sin transferir su propiedad; al venderse, Le Tiende paga a la editorial según el descuento editorial pactado. Un libro sin consignación es propiedad directa de Le Tiende. |
| **Vendedor** | Usuario con permisos para catalogar, ubicar y vender libros. |
| **Administrador** | Usuario con todos los permisos del vendedor, más configuración del sistema y reportes. |
