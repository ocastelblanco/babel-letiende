# 01 — Datos: enriquecer el inventario con sinopsis

**Fecha:** 16/11/2026 · **Fase:** 1 · **trace_id:** `T-0011` (backend) · `T-0012` (Catalogar y Editar) · `T-0013` (carga retroactiva) · **Estado:** `T-0011` fusionada y verificada en `staging`; `T-0012` implementada (PR abierto); `T-0013` pendiente

## 1. Objetivo

Que cada libro del inventario tenga, además de título y precio, lo que un asistente necesita para recomendarlo: **sinopsis, categorías, idioma, páginas y clasificación por edad**. Es la capacidad de "fuentes de conocimiento: estructura, carga y consulta".

**Criterio de terminado de la Fase 1:** los libros nuevos entran con sinopsis; el inventario existente se enriquece con una carga por lotes; hay un reporte de cobertura por idioma y por fuente. Esta entrada cubre `T-0011` (la base de datos y el backend). El resto se agrega al cerrar `T-0012` y `T-0013`.

## 2. Conceptos y tecnologías

### De dónde sale cada dato

| Dato | Fuente principal | Respaldo |
|---|---|---|
| Sinopsis | Sitios de librerías con permiso `info` (JSON-LD o API VTEX de la tienda) | Google Books (`description`) |
| Categorías, idioma, páginas, clasificación por edad | Google Books (`categories`, `language`, `pageCount`, `maturityRating`) | — |

Google Books se consulta a través de `api.letiende.co`, un proxy compartido que ya usaba Babel. Ese proxy ya devolvía todos estos campos; Babel solo leía cuatro y descartaba el resto.

### Texto plano, nunca HTML

Las fuentes externas entregan la sinopsis con etiquetas (`<p>`, `<b>`, entidades como `&amp;`). Todo lo que entra se convierte a **texto plano** antes de guardarlo: los saltos de párrafo pasan a salto de línea, se eliminan las etiquetas, se descartan los caracteres de control y se recorta a 4.000 caracteres. Es la regla A03 de Babel (nunca reenviar ni renderizar HTML de un tercero) y, para el asistente, una defensa adicional: una sinopsis no puede traer marcado que se confunda con instrucciones.

### Un dato derivado no debe tumbar una operación crítica

Catalogar es la ruta crítica de Babel. Guardar el conocimiento del libro es una escritura aparte, no transaccional. Si falla, el libro **ya quedó catalogado** y el error solo se registra. Se prefirió un libro sin sinopsis (que la carga retroactiva completa después) a un libro que el vendedor no pudo catalogar.

### Ausente no es lo mismo que vacío

En `PUT /api/libros/:bookId` el campo `conocimiento` es opcional. **Ausente significa "no tocar lo que ya hay guardado"**; presente reemplaza el registro completo. Así un cliente que no conoce el campo (una pestaña abierta con la versión anterior de la aplicación) nunca borra datos por omisión.

### Sugerencia editable, no dato confiable (T-0012)

Todo lo que llega de una fuente externa entra al formulario como **sugerencia editable** (regla A08 de Babel): el vendedor ve la sinopsis, su fuente («Fuente: tornamesa.co») y puede corregirla antes de guardar. Si la edita, la fuente pasa a «escrita a mano» automáticamente, porque ya no es lo que dijo la fuente. Es un patrón útil más allá de este proyecto: un dato derivado de un tercero conserva su procedencia hasta que una persona lo hace suyo.

### «Ausente» y «no pude leerlo» son lo mismo para el servidor

En Editar, la sinopsis se carga con una lectura aparte. Si esa lectura falla (red, sesión caducada) o todavía no termina, el formulario **no envía** `conocimiento` al guardar; el servidor interpreta la ausencia como «no tocar» y conserva lo que haya. La alternativa ingenua (enviar el formulario vacío) borraría la sinopsis de un libro por un error de red. Dos pruebas protegen esto y fallan si se quita la condición.

## 3. Decisiones

| Decisión | ADR |
|---|---|
| Tabla aparte `babel-libros-conocimiento`, uso interno, trazabilidad por `fuenteSinopsis` | ADR-018 |

### El hallazgo que cambió el diseño: los términos de Google

Antes de escribir código se revisaron los términos. La sección 5.e de los [Términos de las APIs de Google](https://developers.google.com/terms) (modificados el 9/11/2021) prohíbe, salvo permiso del dueño del contenido o de la ley, "scrape, build databases, or otherwise create permanent copies" del contenido devuelto por las APIs. Los [términos de Books](https://developers.google.com/books/terms) (2012) no dicen nada específico sobre descripciones, pero obligan a retirar contenido si alguien alega infracción.

Guardar sinopsis es una copia permanente, y los embeddings de la Fase 2 serían una obra derivada. El plan original decía "si no se puede guardar, se usa internamente", pero el uso interno también implica guardarlas. El usuario eligió seguir con **uso interno y trazabilidad**: las sinopsis nunca se muestran textuales al visitante ni van al repositorio, y cada una anota su fuente para poder purgar de una sola pasada todo lo que vino de Google si surge un reclamo.

Dos cosas que este análisis **no** resolvió, y que quedan anotadas: no se revisaron los términos de uso de los sitios de librerías que se consultan, y los términos de Google se leyeron en una sola pasada, sin consultar a un abogado.

### Por qué una tabla aparte y no campos en `babel-libros`

El plan original ponía los campos dentro de `babel-libros`. Al leer el código aparecieron tres problemas:

1. **Fuga.** El detalle público de un libro responde `{ ...libro, ubicacion, ejemplares }`: cualquier campo nuevo del libro saldría en un endpoint sin autenticación.
2. **Tamaño.** El inventario se sirve con un `Scan` completo en una sola respuesta de Lambda, que tiene un tope duro de 6 MB. Con 3.000 libros y sinopsis de hasta 4 KB, el inventario rozaría ese tope y empezaría a fallar con 500.
3. **Purga.** Borrar todo lo que vino de Google sería una edición masiva del inventario en lugar de borrar filas de una tabla.

El costo de la tabla aparte es una escritura más por catalogación. Con `PAY_PER_REQUEST` y sin índices son centavos al mes (ver `docs/advertencia-urgente-costos-aws.md`).

## 4. Qué se hizo

1. `server/api/services/api-letiende.ts`: lee los campos nuevos de Google Books, con normalización (`aTextoPlano`, categorías separadas por `/` y sin repetidos, idioma con forma ISO, páginas enteras positivas, clasificación `NOT_MATURE`/`MATURE`; cualquier otra cosa se descarta).
2. `server/api/services/scraping.ts`: los 6 adaptadores (Lerner, Nacional, Librería de la U, Tornamesa, Casa Tomada, Busca Libre) extraen la descripción con `cheerio` y devuelven solo `.text()`.
3. `server/api/handlers/metadatos.ts`: la sinopsis de un sitio con `info: true` desplaza a la de Google; la fuente queda anotada (`sitio:<dominio>` o `google-books`). Los sitios `info` ahora se consultan siempre, no solo cuando falta algún dato.
4. `server/api/handlers/libros.ts`: `validarConocimiento`, persistencia en la tabla nueva desde `POST`/`PUT`, borrado en `DELETE` y `GET /api/libros/:bookId/conocimiento` (solo vendedor y administrador).
5. `serverless.yml`: tabla `PAY_PER_REQUEST` sin índices, variable `TABLA_CONOCIMIENTO` y permisos mínimos por función (la función de lectura solo lee; catalogar y editar solo escriben; eliminar solo borra).

## 5. Cifras medidas

| Cifra | Valor | Cómo |
|---|---|---|
| Sitios cuya descripción es una sinopsis real | 5 de 6 | Fixtures reales de cada sitio, 16/11/2026 |
| Sitios cuya descripción es solo el título | 1 (Lerner: `"ANIQUILACION"`) | Mismo fixture |
| Pruebas del backend | 453 → 499 | `npm run test:api` |

La **cobertura real** de sinopsis sobre el inventario se mide con la carga retroactiva (`T-0013`) y se agrega aquí.

## 6. Qué falló y cómo se corrigió

- **Las pruebas con datos reales encontraron el problema de Lerner.** Al conectar los adaptadores, las pruebas que usan fixtures reales de cada sitio empezaron a fallar de inmediato, y el diff mostró que Lerner "tiene sinopsis" pero es el propio título. Sin esas pruebas, esa fuente habría ocupado el lugar de una sinopsis útil de otro sitio. Se agregó un filtro de calidad: una descripción de menos de 40 caracteres, o idéntica al título, no cuenta como sinopsis.
- **Una prueba existente codificaba el comportamiento anterior** ("solo se consultan los sitios con precio cuando la información ya está completa"). Cambió a propósito: ahora los sitios `info` se consultan siempre porque la sinopsis de un sitio se prefiere a la de Google. La prueba se reescribió para que afirme el comportamiento nuevo, en lugar de borrarla.
- **Un bug de la prueba, no del código:** `fuenteSinopsis` salía `google-books` cuando el mock no traía sinopsis, porque `undefined !== null` es verdadero. El código ahora comprueba si la sinopsis tiene contenido en lugar de comparar con `null`.

- **Las pruebas antiguas se rompieron de forma útil.** Al agregar campos a la respuesta de metadatos, las pruebas de Catalogar con mocks incompletos fallaron con un error sobre `categorias` indefinido: el servicio real completa los campos que un backend anterior no manda, pero los mocks no. Se corrigieron los mocks, y el servicio ahora tiene una prueba propia para el caso de un backend sin los campos nuevos (por ejemplo, durante un despliegue a medias).
- **Un hallazgo de seguridad que ya existía.** Al decidir dónde guardar la sinopsis, la pregunta "¿qué endpoint público devuelve el ítem completo del libro?" llevó a comprobar la ficha pública en `staging`: devolvía `costo`, `utilidadCatalogo`, `porcentajeDescuentoEditorial`, `cantidadTotal` y el correo de quien catalogó, sin sesión. No tenía relación con el asistente, pero es exactamente la clase de fuga que una herramienta del asistente habría heredado. Se corrigió en un hotfix aparte con una lista blanca y una prueba que falla si reaparece un campo interno; la lección para el asistente (ADR-014) es que **ningún dato llega al modelo ni a un endpoint público por esparcir un ítem de la base de datos**.

## 7. Esfuerzo

Eventos de esta fase en [`../metrics/events/`](../metrics/events/).

## 8. Fuentes

- [Google APIs Terms of Service](https://developers.google.com/terms), última modificación 9/11/2021 (consultado el 16/11/2026).
- [Google Books APIs Terms of Service](https://developers.google.com/books/terms), última modificación 25/4/2012 (consultado el 16/11/2026).
- `docs/advertencia-urgente-costos-aws.md` (revisión previa a crear la tabla).
- Código: `server/api/services/api-letiende.ts`, `server/api/services/scraping.ts`, `server/api/handlers/metadatos.ts`, `server/api/handlers/libros.ts`.
