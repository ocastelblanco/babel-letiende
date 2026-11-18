import { describe, expect, it } from 'vitest';
import {
  HERRAMIENTAS,
  MAXIMO_LIBROS_POR_CONSULTA_DE_DISPONIBILIDAD,
  NOMBRES_HERRAMIENTAS,
  buscarPolitica,
  cargarPoliticas,
  interpretarPoliticas,
  validarLlamada,
} from './herramientas-asistente';

describe('declaraciones', () => {
  it('hay una declaración por herramienta, con descripción y parámetros', () => {
    expect(HERRAMIENTAS.map((h) => h.nombre)).toEqual([...NOMBRES_HERRAMIENTAS]);
    for (const herramienta of HERRAMIENTAS) {
      expect(herramienta.descripcion.length).toBeGreaterThan(20);
      expect(herramienta.parametros['type']).toBe('object');
      expect(Array.isArray(herramienta.parametros['required'])).toBe(true);
    }
  });

  it('ninguna herramienta ofrece parámetros para campos internos', () => {
    expect(JSON.stringify(HERRAMIENTAS)).not.toMatch(/costo|utilidad|descuento|ventas/i);
  });
});

describe('validarLlamada — buscar_libros', () => {
  it('acepta una consulta con filtros y los normaliza', () => {
    expect(
      validarLlamada('buscar_libros', { consulta: '  fantasía épica ', idioma: 'EN', precio_maximo: 50000, excluir_contenido_adulto: true }),
    ).toEqual({
      ok: true,
      nombre: 'buscar_libros',
      consulta: 'fantasía épica',
      filtros: { idioma: 'en', precioMaximo: 50000, excluirContenidoAdulto: true },
    });
  });

  it('solo la consulta es obligatoria; los filtros nulos se ignoran', () => {
    expect(validarLlamada('buscar_libros', { consulta: 'misterio', idioma: null, precio_maximo: null })).toEqual({
      ok: true,
      nombre: 'buscar_libros',
      consulta: 'misterio',
      filtros: {},
    });
  });

  it.each([
    ['sin consulta (lo que hizo el modelo real en la verificación F)', { idioma: 'fr', precio_maximo: 12000 }],
    ['consulta vacía', { consulta: '   ' }],
    ['consulta que no es texto', { consulta: 5 }],
    ['consulta enorme', { consulta: 'x'.repeat(301) }],
    ['idioma inválido', { consulta: 'a', idioma: 'francés' }],
    ['precio como texto', { consulta: 'a', precio_maximo: 'doce mil' }],
    ['precio negativo', { consulta: 'a', precio_maximo: -5 }],
    ['precio absurdo', { consulta: 'a', precio_maximo: 1e12 }],
    ['adulto como texto', { consulta: 'a', excluir_contenido_adulto: 'si' }],
  ])('rechaza: %s', (_nombre, argumentos) => {
    const resultado = validarLlamada('buscar_libros', argumentos);
    expect(resultado.ok).toBe(false);
  });
});

describe('validarLlamada — consultar_disponibilidad', () => {
  it('acepta de 1 a 5 identificadores y quita los repetidos', () => {
    expect(validarLlamada('consultar_disponibilidad', { book_ids: ['a', ' b ', 'a'] })).toEqual({
      ok: true,
      nombre: 'consultar_disponibilidad',
      bookIds: ['a', 'b'],
    });
  });

  it.each([
    ['sin lista', {}],
    ['lista vacía', { book_ids: [] }],
    ['no es lista', { book_ids: 'a' }],
    ['demasiados', { book_ids: Array.from({ length: MAXIMO_LIBROS_POR_CONSULTA_DE_DISPONIBILIDAD + 1 }, (_, i) => `l${i}`) }],
    ['elemento que no es texto', { book_ids: ['a', 5] }],
    ['elemento vacío', { book_ids: ['a', ' '] }],
    ['identificador enorme', { book_ids: ['x'.repeat(65)] }],
  ])('rechaza: %s', (_nombre, argumentos) => {
    expect(validarLlamada('consultar_disponibilidad', argumentos).ok).toBe(false);
  });
});

describe('validarLlamada — consultar_politicas y herramientas desconocidas', () => {
  it('acepta un tema', () => {
    expect(validarLlamada('consultar_politicas', { tema: ' horarios ' })).toEqual({ ok: true, nombre: 'consultar_politicas', tema: 'horarios' });
  });

  it.each([{}, { tema: '' }, { tema: 7 }, { tema: 'x'.repeat(81) }])('rechaza un tema inválido %j', (argumentos) => {
    expect(validarLlamada('consultar_politicas', argumentos).ok).toBe(false);
  });

  it('rechaza una herramienta que no existe y no refleja el nombre completo', () => {
    const resultado = validarLlamada('borrar_inventario', {});
    expect(resultado.ok).toBe(false);
    const largo = validarLlamada('x'.repeat(500), {});
    expect(largo.ok === false && largo.error.length).toBeLessThan(120);
  });
});

describe('interpretarPoliticas', () => {
  const documento = `# Políticas

Notas para quien edita.

## Horarios

Lunes a sábado de 10 a. m. a 6 p. m.

## Formas de pago

<!-- por completar -->

## Cambios y devoluciones
Se aceptan cambios dentro de los 8 días con la factura.
<!-- nota interna -->
`;

  it('toma cada «##» como un tema y descarta los que solo tienen comentarios', () => {
    expect(interpretarPoliticas(documento)).toEqual([
      { titulo: 'Horarios', contenido: 'Lunes a sábado de 10 a. m. a 6 p. m.' },
      { titulo: 'Cambios y devoluciones', contenido: 'Se aceptan cambios dentro de los 8 días con la factura.' },
    ]);
  });

  it('tolera finales de línea de Windows y un archivo sin temas', () => {
    expect(interpretarPoliticas('## Horarios\r\nTodos los días.\r\n')).toEqual([{ titulo: 'Horarios', contenido: 'Todos los días.' }]);
    expect(interpretarPoliticas('# Solo título\n\ntexto')).toEqual([]);
    expect(interpretarPoliticas('')).toEqual([]);
  });

  it('un comentario que abarca varias líneas no deja contenido', () => {
    expect(interpretarPoliticas('## Envíos\n<!--\nvarias\nlíneas\n-->\n')).toEqual([]);
  });
});

describe('buscarPolitica', () => {
  const temas = [
    { titulo: 'Horarios', contenido: 'Lunes a sábado.' },
    { titulo: 'Formas de pago', contenido: 'Efectivo y tarjeta.' },
    { titulo: 'Cambios y devoluciones', contenido: '8 días.' },
  ];

  it('encuentra por el título aunque cambien tildes, mayúsculas o haya texto de más', () => {
    expect(buscarPolitica(temas, 'HORARIOS')).toMatchObject({ encontrado: true, tema: 'Horarios' });
    expect(buscarPolitica(temas, 'los horarios de atención')).toMatchObject({ encontrado: true, tema: 'Horarios' });
    expect(buscarPolitica(temas, 'formas de págo')).toMatchObject({ encontrado: true, tema: 'Formas de pago' });
  });

  it('encuentra por una palabra significativa en común', () => {
    expect(buscarPolitica(temas, 'devolución')).toMatchObject({ encontrado: true, tema: 'Cambios y devoluciones' });
  });

  it('si no hay tema, devuelve los disponibles y nada inventado', () => {
    expect(buscarPolitica(temas, 'garantía de tapa dura')).toEqual({
      encontrado: false,
      temasDisponibles: ['Horarios', 'Formas de pago', 'Cambios y devoluciones'],
    });
    expect(buscarPolitica([], 'horarios')).toEqual({ encontrado: false, temasDisponibles: [] });
  });
});

describe('cargarPoliticas', () => {
  it('lee el archivo real del repositorio sin lanzar', () => {
    const temas = cargarPoliticas();
    expect(Array.isArray(temas)).toBe(true);
    for (const tema of temas) {
      expect(tema.titulo).not.toBe('');
      expect(tema.contenido).not.toBe('');
    }
  });

  it('sin archivo devuelve una lista vacía', () => {
    expect(cargarPoliticas('/ruta/que/no/existe')).toEqual([]);
  });
});
