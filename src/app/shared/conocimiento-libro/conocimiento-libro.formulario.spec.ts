import {
  aDatosConocimiento,
  aValorFormulario,
  conocimientoVacio,
  crearGrupoConocimiento,
  etiquetaFuenteSinopsis,
  type ValorConocimientoFormulario,
} from './conocimiento-libro.formulario';

const valorVacio: ValorConocimientoFormulario = {
  sinopsis: '',
  categorias: '',
  idioma: '',
  paginas: null,
  clasificacionEdad: '',
};

describe('aDatosConocimiento', () => {
  it('un formulario vacío da todo en null y sin fuente', () => {
    const datos = aDatosConocimiento(valorVacio, 'google-books');
    expect(datos).toEqual({
      sinopsis: null,
      categorias: [],
      idioma: null,
      paginas: null,
      clasificacionEdad: null,
      fuenteSinopsis: null,
    });
    expect(conocimientoVacio(datos)).toBe(true);
  });

  it('normaliza: recorta la sinopsis, separa categorías por coma sin repetidas ni vacías, idioma en minúscula', () => {
    const datos = aDatosConocimiento(
      { ...valorVacio, sinopsis: '  Texto.  ', categorias: ' A, B ,, A , ', idioma: ' ES ', paginas: 10, clasificacionEdad: 'MATURE' },
      'sitio:www.tornamesa.co',
    );
    expect(datos).toEqual({
      sinopsis: 'Texto.',
      categorias: ['A', 'B'],
      idioma: 'es',
      paginas: 10,
      clasificacionEdad: 'MATURE',
      fuenteSinopsis: 'sitio:www.tornamesa.co',
    });
    expect(conocimientoVacio(datos)).toBe(false);
  });

  it('una sinopsis sin fuente conocida es "manual"; sin sinopsis no hay fuente', () => {
    expect(aDatosConocimiento({ ...valorVacio, sinopsis: 'Algo.' }, null).fuenteSinopsis).toBe('manual');
    expect(aDatosConocimiento({ ...valorVacio, idioma: 'es' }, 'google-books').fuenteSinopsis).toBeNull();
  });

  it('recorta a los topes del backend: 10 categorías de máximo 100 caracteres', () => {
    const muchas = Array.from({ length: 15 }, (_, i) => `cat${i}`).join(',');
    expect(aDatosConocimiento({ ...valorVacio, categorias: muchas }, null).categorias).toHaveLength(10);
    const larga = aDatosConocimiento({ ...valorVacio, categorias: 'x'.repeat(150) }, null).categorias[0];
    expect(larga).toHaveLength(100);
  });

  it('páginas decimales o no numéricas quedan en null', () => {
    expect(aDatosConocimiento({ ...valorVacio, paginas: 10.5 }, null).paginas).toBeNull();
  });
});

describe('aValorFormulario', () => {
  it('null da el formulario vacío', () => {
    expect(aValorFormulario(null)).toEqual(valorVacio);
  });

  it('une las categorías con coma y convierte null en vacío', () => {
    expect(
      aValorFormulario({
        sinopsis: null,
        categorias: ['A', 'B'],
        idioma: 'es',
        paginas: null,
        clasificacionEdad: null,
        fuenteSinopsis: null,
      }),
    ).toEqual({ ...valorVacio, categorias: 'A, B', idioma: 'es' });
  });

  it('ida y vuelta: lo que se guarda vuelve igual', () => {
    const datos = aDatosConocimiento(
      { sinopsis: 'S', categorias: 'A, B', idioma: 'en', paginas: 5, clasificacionEdad: 'NOT_MATURE' },
      'manual',
    );
    expect(aDatosConocimiento(aValorFormulario(datos), datos.fuenteSinopsis)).toEqual(datos);
  });
});

describe('crearGrupoConocimiento (validaciones)', () => {
  it('acepta valores válidos y vacíos', () => {
    const grupo = crearGrupoConocimiento();
    expect(grupo.valid).toBe(true);
    grupo.patchValue({ idioma: 'es', paginas: 224, sinopsis: 'ok' });
    expect(grupo.valid).toBe(true);
    grupo.patchValue({ idioma: 'pt-BR' });
    expect(grupo.valid).toBe(true);
  });

  it.each([
    ['idioma con símbolos', { idioma: '<script>' }],
    ['idioma de un solo carácter', { idioma: 'e' }],
    ['páginas en cero', { paginas: 0 }],
    ['páginas por encima del tope', { paginas: 20_001 }],
    ['páginas decimales', { paginas: 10.5 }],
    ['sinopsis de más de 4000 caracteres', { sinopsis: 'a'.repeat(4001) }],
  ])('rechaza %s', (_motivo, valor) => {
    const grupo = crearGrupoConocimiento();
    grupo.patchValue(valor);
    expect(grupo.invalid).toBe(true);
  });
});

describe('etiquetaFuenteSinopsis', () => {
  it.each([
    [null, ''],
    ['google-books', 'Google Books'],
    ['manual', 'escrita a mano'],
    ['sitio:www.tornamesa.co', 'tornamesa.co'],
    ['sitio:libreriadelau.com', 'libreriadelau.com'],
    ['otra', 'otra'],
  ])('%s → "%s"', (fuente, esperado) => {
    expect(etiquetaFuenteSinopsis(fuente)).toBe(esperado);
  });
});
