# 03 — Índice de embeddings

**Fecha:** 17/11/2026 · **Fase:** 2 · **trace_id:** `T-0022` · **Estado:** implementado, PR abierto

## 1. Objetivo

Que el asistente pueda encontrar, entre los libros del inventario, los que se parecen a lo que pide un visitante, sin que un modelo tenga que leer todo el catálogo en cada pregunta. Esta entrada cubre solo el índice y su reconstrucción; la Lambda del asistente que lo consulta es `T-0023`.

## 2. Conceptos y tecnologías

### Un archivo y fuerza bruta, no una base de datos vectorial

Con unos 3.000 libros, comparar la pregunta contra todos los vectores en memoria tarda microsegundos y no cuesta nada. Una base de datos vectorial administrada (por ejemplo un servicio de búsqueda vectorial de AWS) tiene costo fijo mensual y complejidad que este tamaño no justifica, y chocaría con el objetivo de costo cercano a cero (`docs/advertencia-urgente-costos-aws.md`). Es una decisión que se revisa si el inventario crece en un orden de magnitud.

### Qué guarda el archivo y qué no

Vectores de 768 dimensiones cuantizados a `int8` (norma 1, escala 127) y, por libro, lo mínimo para filtrar sin volver a la base de datos: `bookId`, idioma, clasificación por edad, una huella del texto y si el libro no tiene sinopsis. **No guarda ningún texto de sinopsis**: son de terceros, el repositorio es público y el bucket es privado de todos modos. Con la cuantización, 3.000 libros ocupan unos 2,3 MB en vez de 9,2 MB; el puntaje de similitud cambia del orden del 1 %, suficiente para ordenar candidatos.

Formato binario propio y simple (magia `BIDX`, versión, encabezado JSON, vectores), con validación al leerlo: un archivo truncado, de otra versión o corrupto se rechaza con un error claro y la reconstrucción parte de cero en vez de servir basura.

### Reconstrucción incremental por huella, no por fecha

El plan original decía reconstruir los libros con `actualizadoEn` posterior al índice. Lo cambié por una **huella del texto** (título + autor + categorías + sinopsis), porque el título y el autor viven en `babel-libros` y editarlos no toca la fecha del conocimiento: con la fecha, un título corregido nunca se re-indexaría. La huella no incluye el idioma ni la clasificación por edad: un cambio solo de idioma refresca el dato de filtro sin pedir otro vector. Si cambia el modelo o las dimensiones se recalcula todo, porque vectores de modelos distintos no son comparables entre sí.

### Reanudable y sin perder libros

Cada corrida pide vectores solo de los libros nuevos o cambiados, en lotes de 50, con un presupuesto de 12 minutos. Si se agota el tiempo o el proveedor devuelve un error (cuota, caída), guarda lo logrado y la siguiente corrida continúa. Un libro cuyo texto cambió y cuyo vector nuevo no se pudo pedir **conserva su vector anterior** en el índice: uno algo viejo es mejor que ninguno. Los libros sin sinopsis se indexan con título y autor y quedan marcados.

### Escritura condicional

La reconstrucción programada y una invocación manual pueden coincidir. El archivo se escribe con `If-Match` (o `If-None-Match: *` la primera vez): si alguien escribió entre la lectura y la escritura, S3 rechaza y esta corrida no pisa nada.

## 3. Decisiones

- **Programada cada 6 horas solo en `staging`.** En producción la regla queda creada pero apagada hasta que exista el secreto `GEMINI_API_KEY` de ese entorno y se encienda el asistente; una función sin clave fallaría en cada corrida.
- **Bucket privado**, cifrado, con bloqueo de todo acceso público; la Lambda solo puede leer y escribir `indice/*` y listar el bucket (sin `ListBucket`, un objeto inexistente responde 403 en vez de 404 y la primera corrida fallaría).
- **El rol IAM solo lee** (`Scan`) libros y conocimiento: nunca escribe en tablas.
- **La clave de Gemini llega como variable de entorno** de la Lambda, igual que `FIREBASE_SERVICE_ACCOUNT_BABEL`. Es el mecanismo ya aceptado en el proyecto; moverlo a un gestor de secretos es una mejora posible y se anota en los riesgos.

## 4. Cifras medidas

| Cifra | Valor | Cómo |
|---|---|---|
| Libros indexados en `staging` | 25 de 25 | Invocación real de la Lambda, 17/11/2026 |
| Primera corrida | 1,7 s, 6.096 tokens de entrada (≈ 244 por libro) | Resumen de la propia Lambda |
| Segunda corrida sin cambios | 94 ms, 0 tokens, sin escribir | Ídem |
| Tamaño del archivo | 22.676 bytes (25 × 768 de vectores + encabezado) | `HeadObject` |
| Proyección para 3.000 libros | ≈ 730.000 tokens de entrada y ≈ 2,3 MB | Extrapolación de lo anterior, no medida |

A la tarifa de `gemini-embedding-2` que reporta la documentación (US$ 0,20 por millón de tokens, sin verificar contra la factura), indexar todo el inventario cuesta del orden de US$ 0,15, una sola vez; después solo se paga por los libros que cambian.

## 5. Qué falló y cómo se corrigió

- **Un test del presupuesto de tiempo no probaba lo que decía:** con pausas de 6 minutos el reloj simulado quedaba justo en el límite (12 min no es *mayor que* 12) y la corrida terminaba completa. Se subió la pausa simulada a 7 minutos.
- **Dos defectos de diseño que encontré antes de probar:** el conteo de «nuevos» y «actualizados» salía mal cuando un lote fallaba a medias, y un libro cuyo texto cambió desaparecía del índice si el proveedor fallaba justo en su lote. Ahora se cuentan por conjuntos de `bookId` y se conserva el vector anterior.

## 6. Esfuerzo

Eventos en [`../metrics/events/`](../metrics/events/).
