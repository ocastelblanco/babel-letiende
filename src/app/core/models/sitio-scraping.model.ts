/**
 * Sitio de scraping administrable (`plan-obtencion-info-libros.md` §5,
 * ADR-010, `MEMORY.md` §3). Reemplaza el modelo de lista blanca/lista negra
 * estática por una sola lista editable desde `/admin/sitios`: cada fila
 * declara, con dos banderas independientes, si el sitio sirve como fuente
 * de metadatos bibliográficos (`info`) y/o de precio de venta al público
 * (`pvp`). `{ info: false, pvp: false }` equivale a completamente
 * prohibido. `dominio` es la clave primaria natural, suministrada por el
 * administrador al crear (no la genera el backend) — mismo patrón que
 * `editorial` en `DescuentoEditorial`.
 *
 * Esta tabla solo expresa *política* (qué sitios y para qué). El
 * *mecanismo* de extracción (plantilla de URL de búsqueda por ISBN +
 * selectores CSS) vive en código (`server/api/services/scraping.ts`,
 * Tarea 2) y la guardia SSRF (ADR-011) es fija e independiente de esta
 * lista — nunca depende de datos administrables.
 */
export interface SitioScraping {
  /** Hostname normalizado (ej. "www.librerialerner.com.co"), clave primaria. */
  dominio: string;
  /** Etiqueta legible (ej. "Librería Lerner"). */
  nombre: string;
  /** URL base del sitio (ej. "https://www.librerialerner.com.co"). */
  url: string;
  /** Autorizado para extraer título/autor/editorial/portada. */
  info: boolean;
  /** Autorizado para extraer precio de venta al público. */
  pvp: boolean;
  /** Orden en la cola de fallback (menor = primero). */
  prioridad: number;
}
