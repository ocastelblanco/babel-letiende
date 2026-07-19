import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formatea un precio en pesos colombianos como `$45.000` (CLAUDE.md §4: punto
 * como separador de miles, sin decimales). Usa `Intl.NumberFormat` en vez del
 * `CurrencyPipe`/`DecimalPipe` de Angular para no depender de registrar los
 * datos del locale `es-CO` (no incluidos por defecto, complican el bundle SSR).
 */
@Pipe({ name: 'pvp' })
export class PvpPipe implements PipeTransform {
  private readonly formateador = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  });

  transform(valor: number): string {
    return `$${this.formateador.format(valor)}`;
  }
}
