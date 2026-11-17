import { describe, expect, it } from 'vitest';
import { idiomaDesdeIsbn, idiomaDesdeTexto, inferirIdioma } from './idioma';

describe('idiomaDesdeIsbn', () => {
  it.each([
    ['9789586390125', 'es'], // 978-958 Colombia
    ['9788437604947', 'es'], // 978-84 España
    ['9786071234567', 'es'], // 978-607 México
    ['9780140449136', 'en'], // 978-0
    ['9781408855652', 'en'], // 978-1
    ['9782070368228', 'fr'], // 978-2
    ['9788535902778', 'pt'], // 978-85 Brasil
    ['9791034743391', 'fr'], // 979-10
    ['9798888888880', 'en'], // 979-8
  ])('%s → %s', (isbn, esperado) => {
    expect(idiomaDesdeIsbn(isbn)).toBe(esperado);
  });

  it('acepta ISBN-10 y guiones', () => {
    expect(idiomaDesdeIsbn('958-639-012-X')).toBe('es');
    expect(idiomaDesdeIsbn('978-958-639-012-5')).toBe('es');
  });

  it.each([null, undefined, '', 'abc', '12345', '9789999999999'])(
    '%s no es concluyente',
    (isbn) => {
      expect(idiomaDesdeIsbn(isbn as string | null)).toBeNull();
    },
  );
});

describe('idiomaDesdeTexto', () => {
  const ES =
    'La historia de una joven que descubre los secretos de su familia durante un verano en el que todo cambia para ella y sus amigos.';
  const EN =
    'The story of a young woman who discovers the secrets of her family during a summer when everything changes for her and all of her friends.';
  const PT =
    'A história de uma jovem que descobre os segredos da sua família durante um verão em que tudo muda para ela e não só para os amigos.';

  it('reconoce español, inglés y portugués', () => {
    expect(idiomaDesdeTexto(ES)).toBe('es');
    expect(idiomaDesdeTexto(EN)).toBe('en');
    expect(idiomaDesdeTexto(PT)).toBe('pt');
  });

  it('un texto corto o vacío no se adivina', () => {
    expect(idiomaDesdeTexto('Una novela')).toBeNull();
    expect(idiomaDesdeTexto('')).toBeNull();
    expect(idiomaDesdeTexto(null)).toBeNull();
  });

  it('un texto sin palabras funcionales reconocibles devuelve null', () => {
    expect(
      idiomaDesdeTexto(
        'Harry Potter Hogwarts Gryffindor Slytherin Hufflepuff Ravenclaw Dumbledore Snape Hermione Ron Draco Voldemort',
      ),
    ).toBeNull();
  });
});

describe('inferirIdioma', () => {
  it('el ISBN manda sobre el texto', () => {
    expect(
      inferirIdioma(
        '9789586390125',
        'The story of a young woman who discovers the secrets of her family and all of her friends.',
      ),
    ).toBe('es');
  });

  it('sin ISBN concluyente usa la sinopsis', () => {
    const texto =
      'The story of a young woman who discovers the secrets of her family during a summer when everything changes for all of them.';
    expect(inferirIdioma('9789999999999', texto)).toBe('en');
  });

  it('sin ninguna de las dos devuelve null', () => {
    expect(inferirIdioma(null, null)).toBeNull();
  });
});
