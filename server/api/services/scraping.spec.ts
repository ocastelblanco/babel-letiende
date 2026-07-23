import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dnsLookupMock = vi.fn();

vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup: (...args: unknown[]) => dnsLookupMock(...args),
    },
  },
}));

// `vi.mock('node:dns', ...)` se hoistea por encima de este import, así que
// `scraping.ts` ya ve el mock cuando hace `import dns from 'node:dns'`.
import {
  buscarLernerPorTexto,
  buscarNacionalPorTexto,
  buscarPvpEnLernerPorTexto,
  buscarPvpEnNacionalPorTexto,
  buscarPvpEnTornamesaPorTexto,
  esUrlSegura,
  scrapearSitio,
  type SitioScraping,
} from './scraping';

const RUTA_FIXTURES = join(__dirname, '__fixtures__/scraping');

function leerFixture(nombre: string): string {
  return readFileSync(join(RUTA_FIXTURES, nombre), 'utf-8');
}

function sitio(dominio: string): SitioScraping {
  return { dominio, nombre: dominio, url: `https://${dominio}`, info: true, pvp: true, prioridad: 1 };
}

const ISBN = '9788433981219';

describe('esUrlSegura (guardia SSRF, ADR-011)', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    dnsLookupMock.mockReset();
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('permite un hostname que resuelve a una IP pública normal', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(esUrlSegura('https://www.ejemplo.com/producto')).resolves.toBe(true);
  });

  it('rechaza un hostname que resuelve al metadata service de AWS (169.254.169.254)', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(esUrlSegura('https://sitio-malicioso.com/x')).resolves.toBe(false);
  });

  it('rechaza IPs privadas/loopback resueltas (127.0.0.1, 10.0.0.5, 192.168.1.1)', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.5.5']) {
      dnsLookupMock.mockResolvedValue([{ address: ip, family: 4 }]);
      await expect(esUrlSegura('https://sitio.com')).resolves.toBe(false);
    }
  });

  it('rechaza IPv6 privadas/loopback/link-local (::1, fc00::1, fe80::1)', async () => {
    for (const ip of ['::1', 'fc00::1', 'fe80::1']) {
      dnsLookupMock.mockResolvedValue([{ address: ip, family: 6 }]);
      await expect(esUrlSegura('https://sitio.com')).resolves.toBe(false);
    }
  });

  it('rechaza si CUALQUIERA de las IPs resueltas (entre varias) es privada', async () => {
    dnsLookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(esUrlSegura('https://sitio.com')).resolves.toBe(false);
  });

  it('rechaza esquema http: sin siquiera intentar resolver DNS', async () => {
    await expect(esUrlSegura('http://sitio.com')).resolves.toBe(false);
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it('rechaza otros esquemas no-https (file:)', async () => {
    await expect(esUrlSegura('file:///etc/passwd')).resolves.toBe(false);
  });

  it('rechaza si la resolución DNS falla (host inexistente)', async () => {
    dnsLookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(esUrlSegura('https://no-existe-este-dominio.invalid')).resolves.toBe(false);
  });

  it('rechaza una URL malformada sin lanzar', async () => {
    await expect(esUrlSegura('no-es-una-url')).resolves.toBe(false);
  });
});

describe('scrapearSitio', () => {
  const fetchOriginal = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchOriginal;
  });

  function respuestaJson(cuerpo: unknown, opciones: Partial<{ ok: boolean; status: number }> = {}) {
    return {
      ok: opciones.ok ?? true,
      status: opciones.status ?? 200,
      headers: new Headers(),
      json: () => Promise.resolve(cuerpo),
      text: () => Promise.resolve(JSON.stringify(cuerpo)),
    } as unknown as Response;
  }

  function respuestaHtml(html: string, opciones: Partial<{ ok: boolean; status: number }> = {}) {
    return {
      ok: opciones.ok ?? true,
      status: opciones.status ?? 200,
      headers: new Headers(),
      json: () => Promise.reject(new Error('no es JSON')),
      text: () => Promise.resolve(html),
    } as unknown as Response;
  }

  describe('Librería Lerner (VTEX)', () => {
    it('extrae título/autor/editorial/portada/pvp desde el fixture real "encontrado"', async () => {
      const fixture = JSON.parse(leerFixture('librerialerner-api-encontrado.json'));
      fetchMock.mockResolvedValue(respuestaJson(fixture));

      const resultado = await scrapearSitio(sitio('www.librerialerner.com.co'), ISBN);

      expect(resultado).toEqual({
        titulo: 'ANIQUILACION',
        autor: 'HOUELLEBECQ, MICHEL',
        editorial: 'ANAGRAMA PANORAMA DE NARRATIVAS',
        portadaUrl:
          'https://librerialerner.vteximg.com.br/arquivos/ids/1419260/principal_9788433981219-1585.jpg?v=638464929451500000',
        pvp: 120000,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `https://www.librerialerner.com.co/api/catalog_system/pub/products/search?ft=${ISBN}`,
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('devuelve campos ausentes (sin lanzar) cuando la API responde un array vacío', async () => {
      fetchMock.mockResolvedValue(respuestaJson([]));
      const resultado = await scrapearSitio(sitio('www.librerialerner.com.co'), ISBN);
      expect(resultado).toEqual({});
    });
  });

  describe('Librería Nacional (VTEX, campos "Autor(es)" y sin Editorial dedicada)', () => {
    it('extrae título/autor/editorial(brand)/portada/pvp desde el fixture real "encontrado"', async () => {
      const fixture = JSON.parse(leerFixture('libreria-nacional-api-encontrado.json'));
      fetchMock.mockResolvedValue(respuestaJson(fixture));

      const resultado = await scrapearSitio(sitio('www.librerianacional.com'), ISBN);

      expect(resultado).toEqual({
        titulo: 'Cien AÑos De Soledad',
        autor: 'Gabriel Garcia Marquez',
        editorial: 'Random House Mondadori Colombia',
        portadaUrl: 'https://b2clibrerianacional.vteximg.com.br/arquivos/ids/244798/Portada.jpg?v=638644376551230000',
        pvp: 79000,
      });
    });

    it('devuelve campos ausentes cuando la API responde un array vacío', async () => {
      fetchMock.mockResolvedValue(respuestaJson([]));
      const resultado = await scrapearSitio(sitio('www.librerianacional.com'), ISBN);
      expect(resultado).toEqual({});
    });
  });

  describe('Tornamesa (búsqueda HTML + JSON-LD de producto)', () => {
    it('extrae título/autor/editorial/portada/pvp encadenando búsqueda y producto', async () => {
      const htmlBusqueda = leerFixture('tornamesa-busqueda.html');
      const htmlProducto = leerFixture('tornamesa-producto.html');
      fetchMock
        .mockResolvedValueOnce(respuestaHtml(htmlBusqueda))
        .mockResolvedValueOnce(respuestaHtml(htmlProducto));

      const resultado = await scrapearSitio(sitio('www.tornamesa.co'), ISBN);

      expect(resultado).toEqual({
        titulo: 'ANIQUILACIÓN',
        autor: 'HOUELLEBECQ, MICHEL',
        editorial: 'ANAGRAMA',
        portadaUrl: '/images/portadas/101759-aniquilacion-edi.jpg',
        pvp: 120000, // "120.000.00" -> 12000000 -> /100 -> 120000
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('www.tornamesa.co/busqueda/listaLibros.php'),
        expect.objectContaining({ redirect: 'manual' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://www.tornamesa.co/libro/aniquilacion_101759',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('devuelve campos ausentes cuando la búsqueda no contiene ningún link de producto', async () => {
      fetchMock.mockResolvedValue(respuestaHtml('<html><body>sin resultados</body></html>'));
      const resultado = await scrapearSitio(sitio('www.tornamesa.co'), ISBN);
      expect(resultado).toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(1); // nunca llega al paso 2
    });
  });

  describe('Busca Libre (JSON-LD de producto, con redirección de búsqueda)', () => {
    it('sigue la redirección de búsqueda (revalidando el host) y extrae los datos del producto', async () => {
      const htmlProducto = leerFixture('buscalibre-producto.html');
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Headers({ location: 'https://www.buscalibre.com.co/libro-aniquilacion/9788433981219/p/54205089' }),
          json: () => Promise.reject(new Error('no es JSON')),
          text: () => Promise.resolve(''),
        } as unknown as Response)
        .mockResolvedValueOnce(respuestaHtml(htmlProducto));

      const resultado = await scrapearSitio(sitio('www.buscalibre.com.co'), ISBN);

      expect(resultado).toEqual({
        titulo: 'Aniquilacion',
        autor: 'Houellebecq, Michel',
        editorial: 'Anagrama',
        portadaUrl: 'https://images.cdn2.buscalibre.com/fit-in/360x360/20/35/2035a86edb5884eb74455e941e7131ca.jpg',
        pvp: 78000, // "78000.00" -> 7800000 -> /100 -> 78000
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://www.buscalibre.com.co/libro-aniquilacion/9788433981219/p/54205089',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('no sigue una redirección hacia un host que la guardia SSRF rechaza (revalida antes de seguir)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
        json: () => Promise.reject(new Error('no es JSON')),
        text: () => Promise.resolve(''),
      } as unknown as Response);

      const resultado = await scrapearSitio(sitio('www.buscalibre.com.co'), ISBN);

      expect(resultado).toEqual({});
      expect(fetchMock).toHaveBeenCalledTimes(1); // nunca llega a pedir el destino de la redirección
    });

    it('devuelve campos ausentes cuando la página no tiene un bloque JSON-LD "Product"', async () => {
      fetchMock.mockResolvedValue(
        respuestaHtml('<html><head><script type="application/ld+json">{"@type":"WebSite"}</script></head></html>'),
      );
      const resultado = await scrapearSitio(sitio('www.buscalibre.com.co'), ISBN);
      expect(resultado).toEqual({});
    });
  });

  describe('parseo de precio (a través de los adaptadores)', () => {
    it('un precio inválido (negativo) desde VTEX se trata como ausente', async () => {
      const fixture = JSON.parse(leerFixture('librerialerner-api-encontrado.json'));
      fixture[0].items[0].sellers[0].commertialOffer.Price = -5;
      fetchMock.mockResolvedValue(respuestaJson(fixture));

      const resultado = await scrapearSitio(sitio('www.librerialerner.com.co'), ISBN);

      expect(resultado.pvp).toBeUndefined();
    });

    it('un precio por encima de PVP_MAXIMO (5.000.000) se trata como ausente', async () => {
      const fixture = JSON.parse(leerFixture('librerialerner-api-encontrado.json'));
      fixture[0].items[0].sellers[0].commertialOffer.Price = 6_000_000;
      fetchMock.mockResolvedValue(respuestaJson(fixture));

      const resultado = await scrapearSitio(sitio('www.librerialerner.com.co'), ISBN);

      expect(resultado.pvp).toBeUndefined();
    });
  });

  describe('dominio sin adaptador de código (ADR-010: "se registra y se omite")', () => {
    it('devuelve {} sin lanzar y sin hacer ninguna petición', async () => {
      const resultado = await scrapearSitio(sitio('www.sitio-no-soportado.com'), ISBN);
      expect(resultado).toEqual({});
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('scrapearSitio nunca lanza', () => {
    it('traga un error de red del adaptador interno y devuelve {}', async () => {
      fetchMock.mockRejectedValue(new Error('fetch failed'));
      const resultado = await scrapearSitio(sitio('www.librerialerner.com.co'), ISBN);
      expect(resultado).toEqual({});
    });

    it('traga un cuerpo JSON inválido sin lanzar', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.reject(new Error('cuerpo inválido')),
        text: () => Promise.resolve('no json'),
      } as unknown as Response);
      const resultado = await scrapearSitio(sitio('www.librerialerner.com.co'), ISBN);
      expect(resultado).toEqual({});
    });
  });
});

describe('buscarLernerPorTexto / buscarNacionalPorTexto (búsqueda por título/autor, TODO.md)', () => {
  const fetchOriginal = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchOriginal;
  });

  function respuestaJson(cuerpo: unknown) {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(cuerpo),
      text: () => Promise.resolve(JSON.stringify(cuerpo)),
    } as unknown as Response;
  }

  it('combina titulo+autor en un único parámetro `ft=`, codificado con %20 (nunca +)', async () => {
    fetchMock.mockResolvedValue(respuestaJson([]));

    await buscarLernerPorTexto('Cien años de soledad', 'Gabriel García Márquez');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.librerialerner.com.co/api/catalog_system/pub/products/search?ft=Cien%20a%C3%B1os%20de%20soledad%20Gabriel%20Garc%C3%ADa%20M%C3%A1rquez',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('construye la query solo con el parámetro que venga (titulo o autor)', async () => {
    fetchMock.mockResolvedValue(respuestaJson([]));

    await buscarNacionalPorTexto(null, 'Houellebecq');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.librerianacional.com/api/catalog_system/pub/products/search?ft=Houellebecq',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('devuelve [] sin hacer ninguna petición cuando titulo y autor vienen vacíos/null', async () => {
    const resultado = await buscarLernerPorTexto(null, '   ');
    expect(resultado).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mapea TODOS los productos de la respuesta (no solo el primero) a CandidatoLibro, extrayendo el isbn limpio del `ean` con sufijo de SKU', async () => {
    const fixture = JSON.parse(leerFixture('librerialerner-api-encontrado.json'));
    const segundoProducto = {
      ...fixture[0],
      productName: 'Otro libro',
      Autor: ['Otro Autor'],
      items: [{ ...fixture[0].items[0], ean: '9780000000001-999' }],
    };
    fetchMock.mockResolvedValue(respuestaJson([fixture[0], segundoProducto]));

    const resultado = await buscarLernerPorTexto('aniquilacion', null);

    expect(resultado).toEqual([
      {
        titulo: 'ANIQUILACION',
        autor: 'HOUELLEBECQ, MICHEL',
        editorial: 'ANAGRAMA PANORAMA DE NARRATIVAS',
        portadaUrl:
          'https://librerialerner.vteximg.com.br/arquivos/ids/1419260/principal_9788433981219-1585.jpg?v=638464929451500000',
        // ean "9788433981219-1585" -> se descarta el sufijo "-1585" de SKU.
        isbn: '9788433981219',
      },
      {
        titulo: 'Otro libro',
        autor: 'Otro Autor',
        editorial: 'ANAGRAMA PANORAMA DE NARRATIVAS',
        portadaUrl:
          'https://librerialerner.vteximg.com.br/arquivos/ids/1419260/principal_9788433981219-1585.jpg?v=638464929451500000',
        isbn: '9780000000001',
      },
    ]);
  });

  it('devuelve isbn null cuando el `ean` no tiene 13 dígitos numéricos en el prefijo (ej. vacío)', async () => {
    const fixture = JSON.parse(leerFixture('libreria-nacional-api-encontrado.json'));
    fetchMock.mockResolvedValue(respuestaJson(fixture));

    const resultado = await buscarNacionalPorTexto('cien años de soledad', null);

    expect(resultado).toEqual([
      {
        titulo: 'Cien AÑos De Soledad',
        autor: 'Gabriel Garcia Marquez',
        editorial: 'Random House Mondadori Colombia',
        portadaUrl: 'https://b2clibrerianacional.vteximg.com.br/arquivos/ids/244798/Portada.jpg?v=638644376551230000',
        isbn: null,
      },
    ]);
  });

  it('devuelve [] cuando la API responde un array vacío (sin candidatos)', async () => {
    fetchMock.mockResolvedValue(respuestaJson([]));
    const resultado = await buscarLernerPorTexto('libro inexistente', null);
    expect(resultado).toEqual([]);
  });

  it('nunca lanza: un error de red degrada a []', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const resultado = await buscarLernerPorTexto('cualquier cosa', null);
    expect(resultado).toEqual([]);
  });

  it('nunca lanza: la guardia SSRF rechazando el host degrada a [] (aunque los dominios sean fijos)', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const resultado = await buscarLernerPorTexto('cualquier cosa', null);
    expect(resultado).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buscarPvpEnLernerPorTexto / buscarPvpEnNacionalPorTexto (PVP por título/autor de un candidato sin ISBN)', () => {
  const fetchOriginal = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchOriginal;
  });

  function respuestaJson(cuerpo: unknown) {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(cuerpo),
      text: () => Promise.resolve(JSON.stringify(cuerpo)),
    } as unknown as Response;
  }

  it('devuelve el precio del primer resultado (mejor match) desde el fixture real de Lerner', async () => {
    const fixture = JSON.parse(leerFixture('librerialerner-api-encontrado.json'));
    fetchMock.mockResolvedValue(respuestaJson(fixture));

    const resultado = await buscarPvpEnLernerPorTexto('Aniquilación', 'Houellebecq');

    expect(resultado).toBe(120000);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.librerialerner.com.co/api/catalog_system/pub/products/search?ft=Aniquilaci%C3%B3n%20Houellebecq',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('devuelve el precio del primer resultado desde el fixture real de Nacional', async () => {
    const fixture = JSON.parse(leerFixture('libreria-nacional-api-encontrado.json'));
    fetchMock.mockResolvedValue(respuestaJson(fixture));

    const resultado = await buscarPvpEnNacionalPorTexto('Cien años de soledad', null);

    expect(resultado).toBe(79000);
  });

  it('devuelve null cuando la API responde un array vacío (sin resultados)', async () => {
    fetchMock.mockResolvedValue(respuestaJson([]));
    const resultado = await buscarPvpEnLernerPorTexto('libro inexistente', null);
    expect(resultado).toBeNull();
  });

  it('devuelve null sin hacer ninguna petición cuando titulo y autor vienen vacíos/null', async () => {
    const resultado = await buscarPvpEnLernerPorTexto(null, '   ');
    expect(resultado).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nunca lanza: un error de red degrada a null', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const resultado = await buscarPvpEnNacionalPorTexto('cualquier cosa', null);
    expect(resultado).toBeNull();
  });

  it('un precio inválido (por encima de PVP_MAXIMO) se trata como ausente (null)', async () => {
    const fixture = JSON.parse(leerFixture('librerialerner-api-encontrado.json'));
    fixture[0].items[0].sellers[0].commertialOffer.Price = 9_000_000;
    fetchMock.mockResolvedValue(respuestaJson(fixture));

    const resultado = await buscarPvpEnLernerPorTexto('cualquier cosa', null);

    expect(resultado).toBeNull();
  });
});

describe('buscarPvpEnTornamesaPorTexto (fallback de PVP por título/autor)', () => {
  const fetchOriginal = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    dnsLookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchOriginal;
  });

  function respuestaHtml(html: string) {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.reject(new Error('no es JSON')),
      text: () => Promise.resolve(html),
    } as unknown as Response;
  }

  it('encadena búsqueda (palabrasBusqueda=texto libre) y producto, igual que por ISBN', async () => {
    const htmlBusqueda = leerFixture('tornamesa-busqueda.html');
    const htmlProducto = leerFixture('tornamesa-producto.html');
    fetchMock.mockResolvedValueOnce(respuestaHtml(htmlBusqueda)).mockResolvedValueOnce(respuestaHtml(htmlProducto));

    const resultado = await buscarPvpEnTornamesaPorTexto('Aniquilación', 'Houellebecq');

    expect(resultado).toBe(120000);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('palabrasBusqueda=Aniquilaci%C3%B3n%20Houellebecq'),
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('devuelve null cuando la búsqueda no contiene ningún link de producto', async () => {
    fetchMock.mockResolvedValue(respuestaHtml('<html><body>sin resultados</body></html>'));
    const resultado = await buscarPvpEnTornamesaPorTexto('libro inexistente', null);
    expect(resultado).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve null sin hacer ninguna petición cuando titulo y autor vienen vacíos/null', async () => {
    const resultado = await buscarPvpEnTornamesaPorTexto(null, null);
    expect(resultado).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
