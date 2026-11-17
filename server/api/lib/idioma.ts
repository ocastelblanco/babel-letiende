/**
 * Inferencia del idioma de un libro cuando ninguna fuente lo entrega
 * (T-0014, `asistente-ia/PLAN.md` Fase 1). Es una heurística, no una verdad:
 * el resultado llega siempre como sugerencia editable (CLAUDE.md A08) y,
 * ante la duda, devuelve `null` en vez de adivinar.
 *
 * Orden de confianza: 1) el grupo de registro del ISBN, 2) el texto de la sinopsis.
 */

/**
 * Grupo de registro del ISBN → idioma predominante de esa zona editorial.
 * Un grupo identifica un país o una zona lingüística, no el idioma de cada título:
 * por eso solo se incluyen los grupos cuyo idioma dominante es inequívoco.
 */
const IDIOMA_POR_GRUPO_978: Readonly<Record<string, string>> = {
  '0': 'en',
  '1': 'en',
  '2': 'fr',
  '3': 'de',
  '4': 'ja',
  '5': 'ru',
  '7': 'zh',
  '65': 'pt',
  '84': 'es',
  '85': 'pt',
  '88': 'it',
  '89': 'ko',
  '607': 'es',
  '612': 'es',
  '950': 'es',
  '956': 'es',
  '958': 'es',
  '968': 'es',
  '970': 'es',
  '972': 'pt',
  '980': 'es',
  '987': 'es',
  '989': 'pt',
};

const IDIOMA_POR_GRUPO_979: Readonly<Record<string, string>> = {
  '8': 'en',
  '10': 'fr',
  '11': 'ko',
  '12': 'it',
  '13': 'es',
};

function coincidirPrefijo(digitos: string, tabla: Readonly<Record<string, string>>): string | null {
  // El grupo mide de 1 a 5 dígitos y ningún grupo es prefijo de otro, así que el primer acierto es el correcto.
  for (let largo = 1; largo <= 5; largo += 1) {
    const idioma = tabla[digitos.slice(0, largo)];
    if (idioma) {
      return idioma;
    }
  }
  return null;
}

/** Idioma probable según el grupo de registro del ISBN-13 o ISBN-10; `null` si el grupo no es concluyente. */
export function idiomaDesdeIsbn(isbn: string | null | undefined): string | null {
  const limpio = (isbn ?? '').replace(/[\s-]/g, '');
  if (/^\d{9}[\dXx]$/.test(limpio)) {
    return coincidirPrefijo(limpio.slice(0, 9), IDIOMA_POR_GRUPO_978);
  }
  if (/^97[89]\d{10}$/.test(limpio)) {
    const resto = limpio.slice(3, 12);
    return coincidirPrefijo(
      resto,
      limpio.startsWith('978') ? IDIOMA_POR_GRUPO_978 : IDIOMA_POR_GRUPO_979,
    );
  }
  return null;
}

/**
 * Palabras funcionales que distinguen cada idioma. Se excluyen a propósito las que
 * se escriben igual en varios (`de`, `a`, `e`, `que`, `para`), que sumarían a ambos.
 */
const PALABRAS_POR_IDIOMA: Readonly<Record<string, ReadonlySet<string>>> = {
  es: new Set(
    'el los las del una por con sus pero como también entre cuando sobre hasta donde desde su se lo más al es un esta este muy sin hay'.split(
      ' ',
    ),
  ),
  en: new Set(
    'the of and to is that for it as was with be by on not this are or his from at which but have an had they you were their one all we can her has there been when will who'.split(
      ' ',
    ),
  ),
  pt: new Set(
    'os não uma dos das são também até isso já pelo pela seu sua ele ela mas foi ao com mais um é'.split(
      ' ',
    ),
  ),
  fr: new Set(
    'le les des du et est une dans pour qui pas sur au avec son ses plus par ce cette il elle sont ne se'.split(
      ' ',
    ),
  ),
  it: new Set(
    'il lo gli della dei delle di che è per con non sono più come anche suo sua nel nella un una'.split(
      ' ',
    ),
  ),
  de: new Set(
    'der die das und ist ein eine nicht mit von zu den dem auf für sich es im auch als'.split(' '),
  ),
};

/** Un texto corto da cifras sin valor: se pide un mínimo de palabras y de aciertos. */
const MINIMO_PALABRAS = 12;
const MINIMO_ACIERTOS = 4;
/** El ganador debe sacarle al segundo al menos esta ventaja, o se considera ambiguo. */
const VENTAJA_MINIMA = 1.5;

/** Idioma probable de un texto por palabras funcionales; `null` si es corto o ambiguo. */
export function idiomaDesdeTexto(texto: string | null | undefined): string | null {
  const palabras = (texto ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (palabras.length < MINIMO_PALABRAS) {
    return null;
  }
  const puntajes = Object.entries(PALABRAS_POR_IDIOMA)
    .map(([idioma, conjunto]) => ({
      idioma,
      aciertos: palabras.filter((palabra) => conjunto.has(palabra)).length,
    }))
    .sort((a, b) => b.aciertos - a.aciertos);
  const [primero, segundo] = puntajes;
  if (!primero || primero.aciertos < MINIMO_ACIERTOS) {
    return null;
  }
  if (segundo && segundo.aciertos > 0 && primero.aciertos < segundo.aciertos * VENTAJA_MINIMA) {
    return null;
  }
  return primero.idioma;
}

/** Primero el ISBN; si no es concluyente, la sinopsis; si tampoco, `null`. */
export function inferirIdioma(
  isbn: string | null | undefined,
  sinopsis: string | null | undefined,
): string | null {
  return idiomaDesdeIsbn(isbn) ?? idiomaDesdeTexto(sinopsis);
}
