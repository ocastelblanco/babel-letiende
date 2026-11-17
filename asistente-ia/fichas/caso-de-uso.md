# Ficha de caso de uso — Asistente de Babel

**Versión:** 1.0 · **Fecha:** 16/11/2026 · **Estado:** escrita antes de construir. Cualquier cambio de alcance posterior se registra abajo con su fecha y su motivo.

---

## 1. Problema

Le Tiende tiene más de 3.000 libros catalogados en Babel, repartidos en varios espacios y muebles. El catálogo público permite buscar por título, autor o ISBN, y eso sirve cuando el visitante ya sabe qué quiere. **No sirve cuando sabe para quién compra o qué le gusta, pero no qué libro.** Es justo la consulta típica de la temporada de regalos:

> "¿Qué libro le compro a mi hijo adolescente, al que le gustan el manga y las historias tipo Harry Potter?"

Hoy esa pregunta solo la responde un vendedor que conozca el inventario de memoria, y la librería no siempre tiene a alguien disponible o con ese conocimiento.

## 2. Usuarios

| Usuario | Qué necesita | Cómo lo usa |
|---|---|---|
| Visitante del catálogo público (en la librería, frente a un mueble con QR, o desde casa) | Recomendaciones de libros **que estén disponibles**, con precio y dónde encontrarlos | Chat en el catálogo público, sin iniciar sesión |
| Vendedor de Le Tiende | Un apoyo para atender preguntas abiertas cuando hay mucha gente | El mismo chat, desde su teléfono |
| Administrador | Saber si el asistente ayuda, cuánto cuesta y poder apagarlo | Tablero `/admin/asistente` e interruptor |

## 3. Alcance

**Sí hace:**
- Recomendar de 3 a 5 libros **del inventario disponible**, explicando cada uno a partir de su sinopsis.
- Respetar restricciones explícitas: idioma, precio máximo, edad del lector, género.
- Informar precio y ubicación física (Espacio → Mueble → Ubicación) consultados en vivo.
- Decir "no tengo nada así" cuando no hay nada adecuado, sin forzar una recomendación.
- Responder preguntas de servicio (horarios, cambios, formas de pago) citando el documento de políticas.

**No hace:**
- Vender, reservar, apartar ni modificar nada: solo lee.
- Recomendar libros que la librería no tiene, ni opinar sobre libros fuera del inventario.
- Revelar costos, márgenes, descuentos editoriales, ventas ni ningún dato interno.
- Pedir o guardar datos personales del visitante.
- Sustituir a un vendedor en reclamos, pagos o casos especiales.

## 4. Datos

| Dato | Fuente | Sensibilidad |
|---|---|---|
| Título, autor, editorial, portada, PVP, existencias, ubicación | `babel-libros` (Babel) | Pública (ya se muestra en el catálogo) |
| Sinopsis, categorías, idioma, páginas, clasificación por edad | Google Books vía `api.letiende.co`; sitios de librerías con permiso `info` | Texto de terceros: se usa internamente; no se publica en el repositorio. Términos de uso por revisar (Fase 1) |
| Políticas de la librería | Documento redactado por Le Tiende | Pública |
| Consultas de los visitantes | Chat | Pueden contener datos personales escritos por el visitante: se enmascaran antes de guardar y se borran por TTL |
| Costo, utilidad, descuento editorial, ventas | `babel-libros`, `babel-ventas` | **Interna: nunca llega al modelo** |

## 5. Indicadores de éxito

Las metas son iniciales y se ajustan con la línea base de la Fase 4. Lo que importa es medirlas, no adivinarlas.

| Indicador | Meta inicial | Dónde se mide |
|---|---|---|
| Libros inventados o agotados en la respuesta final | 0 % (los garantiza el validador) | Suite y registro |
| Libros inventados por el modelo, antes del validador | Reportar la cifra y reducirla entre versiones | Suite y registro |
| Acierto (al menos un libro aceptable entre los propuestos) | Mejorar respecto a v1, medido sobre la suite | Suite |
| Rechazo correcto en consultas sin respuesta posible | Alto; ninguna recomendación forzada | Suite |
| Cumplimiento de restricciones explícitas | Alto | Suite |
| Resistencia a inyección (directa e indirecta) | Ningún caso de la suite logra cambiar el comportamiento | Suite |
| Valoración positiva de los visitantes | Medir desde el lanzamiento | Registro y tablero |
| Costo por conversación y gasto diario | Por debajo del tope configurado | Registro y tablero |
| Latencia p95 | Aceptable para chat (se fija con la línea base) | Registro y tablero |

## 6. Riesgos principales

Detalle y controles en [`riesgos-y-controles.md`](riesgos-y-controles.md).

1. Recomendaciones inventadas o de libros agotados.
2. Inyección de prompt, también la que llega escondida en la sinopsis de un tercero.
3. Abuso del chat público y gasto descontrolado.
4. Fuga de datos internos (costos, márgenes) o personales.
5. Recomendaciones inapropiadas para la edad indicada.
6. Dependencia de un solo proveedor de modelo o retiro de una versión.

## 7. Escalamiento a una persona

- Si el visitante pide algo fuera del alcance (reclamos, pagos, apartar un libro, pedidos especiales), el asistente responde que eso lo atiende el equipo de la librería y da el canal de contacto definido en las políticas.
- Si la consulta no tiene respuesta en el inventario, el asistente lo dice y sugiere preguntarle a un vendedor por pedidos.
- Si el asistente falla o se alcanza un tope, el chat muestra un mensaje fijo de "no disponible por ahora" y la búsqueda normal del catálogo sigue funcionando.
- El administrador puede apagar el asistente al instante con el interruptor, sin desplegar nada.

## 8. Fuera de alcance de esta versión

Recomendación con el historial de ventas, cuentas de visitante, memoria entre visitas, voz, otros idiomas de interfaz y empaquetado nativo.

---

## Registro de cambios de alcance

| Fecha | Cambio | Motivo |
|---|---|---|
| 16/11/2026 | Versión inicial | — |
