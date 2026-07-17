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
| **Vendedor** | Catalogar libros rápido (meta: minimizar segundos por libro dado el volumen de 3.000+), cambiar la ubicación de un libro, registrar una venta en pocos toques desde el celular. |
| **Administrador** | Todo lo del vendedor, más: ver y descargar reportes de ventas, gestionar usuarios, definir descuentos por editorial, crear/editar/borrar estantes. |
| **Visitante público** | Consultar el catálogo completo sin necesidad de crear cuenta: buscar por nombre, autor, tema o ISBN, ver precio y ubicación física dentro de la librería. |

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

Flujo crítico del sistema — debe ser lo más rápido posible dado el volumen de 3.000+ libros a catalogar.

```
Vendedor → Escanea código de barras con la cámara
   ├─ Código detectado → obtiene ISBN
   └─ Sin código de barras → ingresa ISBN manualmente
        └─ Sin ISBN → ingresa nombre del libro y autor manualmente

→ Sistema busca datos del libro (autor, portada, editorial, nombre) con el ISBN/datos disponibles
   ├─ Datos encontrados → se muestran pre-cargados
   └─ Datos no encontrados → el vendedor los completa manualmente

→ Sistema busca el precio de venta al público (PVP)
   ├─ Encontrado por nombre en sitios autorizados (lista blanca) → se pre-carga
   ├─ No encontrado por nombre → reintenta con ISBN u otro dato
   ├─ No encontrado en sitios autorizados → busca en Google (excluyendo sitios prohibidos), precio en pesos colombianos
   └─ No encontrado por ningún medio → el vendedor ingresa el valor manualmente

→ Vendedor confirma/ajusta el % de descuento editorial (si aplica uno distinto al de por defecto de esa editorial, lo elige de una lista; si el libro es propiedad de Le Tiende y no está en consignación, el descuento editorial es 100%)
→ Vendedor indica el número de ejemplares disponibles
→ Vendedor selecciona el estante físico de una lista
→ Sistema guarda el libro catalogado
```

**Sobre el descuento editorial:** es el porcentaje que la editorial reconoce a Le Tiende sobre el PVP en los libros que deja en consignación — no es un descuento al público, sino el margen que le queda a la librería. El valor típico en el contexto colombiano es 35% (PVP $100.000 → la editorial cobra $65.000, Le Tiende retiene $35.000 de utilidad); el administrador puede configurar modelos distintos para editoriales independientes (ver §5.6). Cuando el libro es propiedad de Le Tiende (no está en consignación con ninguna editorial), el descuento editorial es 100%: no hay costo asociado y toda la venta es utilidad de la librería. Este porcentaje es independiente del descuento que el vendedor pueda aplicar al momento de la venta (ver §5.4).

### 5.3 Cambio de estante de un libro

```
Vendedor → Escanea ISBN o busca el libro en la lista de catalogados
   → Selecciona el libro
   → Elige el nuevo estante de una lista
   → Sistema actualiza la ubicación
```

### 5.4 Registro de venta

```
Vendedor → Escanea ISBN del libro a vender
   ├─ Código no disponible/ilegible → busca el libro por nombre en el catálogo

→ Vendedor ajusta el % de descuento de venta (0% por defecto)
→ Vendedor selecciona forma de pago: Efectivo / Tarjeta / Transferencia / Nequi / Daviplata
→ Vendedor presiona "Registrar venta"
→ Sistema marca el libro como vendido, guarda forma de pago y fecha/hora de venta
→ El libro deja de estar disponible para la venta
```

**Sobre el descuento de venta:** es un descuento discrecional, distinto e independiente del descuento editorial (§5.2), que el vendedor acuerda con el comprador al momento de la venta — típicamente para rotar catálogo o al negociar libros que son propiedad de Le Tiende (sin descuento editorial de por medio). Reduce el precio final que paga el cliente; no modifica el costo del libro ni el descuento editorial ya definido al catalogarlo.

### 5.5 Reportes de ventas (solo administrador)

El administrador visualiza y descarga en formato XLSX los libros vendidos, filtrados u ordenados por rango de fecha de venta, PVP, utilidad, costo, editorial o forma de pago.

### 5.6 Configuración de la aplicación (solo administrador)

- Gestión de usuarios: crear, editar, borrar vendedores y administradores.
- Gestión de descuentos por editorial: definir, por editorial, el porcentaje por defecto y una lista de porcentajes alternativos disponibles (afecta el cálculo de costo y utilidad de cada libro catalogado con esa editorial). El valor 100% (libro propio de Le Tiende, sin consignación) está siempre disponible como opción para cualquier libro, independientemente de su editorial.
- Gestión de estantes: crear, editar, borrar. Un estante se compone de: espacio dentro de la librería, mueble y ubicación precisa.

### 5.7 Catálogo público (sin autenticación)

Cualquier persona puede ver el catálogo completo y buscar/filtrar por nombre, autor, tema (si los metadatos lo permiten) o ISBN, obteniendo PVP, ubicación física y demás datos disponibles.

---

## 6. Roadmap

| Feature | Prioridad |
|---|---|
| Autenticación con Google (Firebase Auth) + resolución de rol | Alta |
| Flujo de catalogación completo (escaneo → metadatos → precio → estante) | Alta |
| Registro de venta | Alta |
| Catálogo público de consulta (SSR, sin autenticación) | Alta |
| Cambio de estante de un libro ya catalogado | Media |
| Configuración de estantes (CRUD) | Media |
| Configuración de descuentos de editorial (CRUD) | Media |
| Gestión de usuarios (CRUD) | Media |
| Reportes de ventas + exportación XLSX | Media |
| Modo offline / cola de sincronización para catalogación sin señal | Baja |
| Empaquetado nativo (Capacitor) si el uso como PWA resulta insuficiente | Baja |

---

## 7. Casos de uso

| Actor | Acción | Resultado esperado |
|---|---|---|
| Vendedor | Escanea un libro con código de barras legible | El sistema pre-completa autor, portada, editorial y PVP; el vendedor solo confirma estante y cantidad |
| Vendedor | Escanea un libro sin metadatos disponibles en ninguna fuente | El sistema le permite ingresar todos los datos manualmente sin bloquear el flujo |
| Vendedor | Escanea el ISBN de un libro para venderlo | El sistema encuentra el libro, permite ajustar el descuento de venta y la forma de pago, y lo marca como vendido |
| Vendedor | Cataloga un libro propiedad de Le Tiende, sin consignación | El sistema permite marcar el descuento editorial en 100%, sin costo asociado |
| Vendedor | Cambia el estante de un libro ya catalogado | La nueva ubicación queda reflejada de inmediato en el catálogo público |
| Administrador | Cambia el descuento por defecto de una editorial | Los libros nuevos catalogados de esa editorial usan el nuevo % para calcular costo/utilidad; los ya vendidos conservan el costo/utilidad que tenían al momento de la venta |
| Administrador | Descarga el reporte de ventas del último mes filtrado por forma de pago | Recibe un archivo XLSX con los libros vendidos que cumplen el filtro |
| Administrador | Crea un nuevo usuario vendedor | El nuevo usuario puede iniciar sesión con su cuenta Google y acceder al panel operativo |
| Visitante público | Busca un libro por nombre desde su celular, sin cuenta | Ve el PVP y la ubicación física dentro de la librería, si está disponible |

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
- La búsqueda de precio en sitios web usa una lista blanca de sitios autorizados como primera fuente, y excluye una lista negra de sitios prohibidos al buscar en Google como respaldo.
- La filosofía visual (UX/UI) y el flujo de CI/CD (GitHub Actions) deben ser consistentes con los del proyecto Comandante.
- Babel comparte el inicio de sesión de Google con Comandante (mismo proyecto de autenticación): un usuario puede tener cuenta en ambas aplicaciones sin registrarse dos veces, pero el rol (administrador/vendedor) se define de forma independiente en cada aplicación y en su propia base de datos — administrar usuarios en una no afecta a la otra.

---

## 10. Glosario de negocio

| Término | Definición |
|---|---|
| **PVP** | Precio de Venta al Público del libro. |
| **ISBN** | Código identificador único de un libro (International Standard Book Number), normalmente impreso como código de barras. |
| **Catalogar** | Registrar un libro en el sistema con sus datos, precio, cantidad de ejemplares y ubicación física. |
| **Estante** | Ubicación física de un libro dentro de la librería, compuesta por espacio, mueble y posición precisa. |
| **Lista blanca (sitios autorizados)** | Conjunto de sitios web de confianza donde el sistema busca primero el PVP de un libro. |
| **Lista negra (sitios prohibidos)** | Conjunto de sitios excluidos al hacer la búsqueda de respaldo del PVP en Google. |
| **Descuento editorial** | Porcentaje del PVP que la editorial reconoce a Le Tiende como margen en los libros que deja en consignación (típicamente 35%). Determina el costo (`PVP × (1 − % descuento editorial)`) y la utilidad de catalogación (`PVP × % descuento editorial`) de cada libro. Es 100% cuando el libro es propiedad de Le Tiende y no está en consignación con ninguna editorial. No debe confundirse con el descuento de venta. |
| **Descuento de venta** | Descuento discrecional que el vendedor aplica al precio final al momento de vender un libro, acordado con el comprador (0% por defecto). Es independiente del descuento editorial: reduce lo que paga el cliente, no el costo del libro. |
| **Consignación** | Modalidad en la que una editorial deja libros en Le Tiende para la venta sin transferir su propiedad; al venderse, Le Tiende paga a la editorial según el descuento editorial pactado. Un libro sin consignación es propiedad directa de Le Tiende. |
| **Vendedor** | Usuario con permisos para catalogar, ubicar y vender libros. |
| **Administrador** | Usuario con todos los permisos del vendedor, más configuración del sistema y reportes. |
