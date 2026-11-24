import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AsistenteService, type ResultadoPregunta } from '../../../core/api/asistente.service';
import { ChatBabelbotComponent, AVISO_BABELBOT } from './chat-babelbot.component';

const respuestaConLibro: ResultadoPregunta = {
  exito: true,
  respuesta: {
    texto: 'Te sugiero este.',
    recomendaciones: [{ bookId: 'b1', titulo: 'Libro Uno', autor: 'Autora Uno', pvp: 45000, portadaUrl: null, motivo: 'Encaja con lo que pides.' }],
    sinResultados: false,
    registroId: 'r-1',
  },
};

describe('ChatBabelbotComponent', () => {
  let fixture: ComponentFixture<ChatBabelbotComponent>;
  const servicio = {
    estaDisponible: vi.fn(),
    preguntar: vi.fn(),
    valorar: vi.fn(),
  };

  async function montar(disponible: boolean) {
    servicio.estaDisponible.mockResolvedValue(disponible);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AsistenteService, useValue: servicio }],
    });
    fixture = TestBed.createComponent(ChatBabelbotComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(selector: string) => el().querySelector(selector) as T | null;

  async function abrirYPreguntar(texto: string) {
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    const caja = q<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
    caja.value = texto;
    caja.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLButtonElement>('button[type="submit"]')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    servicio.valorar.mockResolvedValue(true);
  });

  it('no muestra nada si el servidor dice que BabelBot no está disponible para el público', async () => {
    await montar(false);
    expect(el().querySelector('button')).toBeNull();
  });

  it('muestra el botón si está disponible y, al abrirlo, el aviso de IA y qué se guarda', async () => {
    await montar(true);
    expect(q('button')?.textContent).toContain('BabelBot');
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(q('[data-testid="aviso-babelbot"]')?.textContent?.trim()).toBe(AVISO_BABELBOT);
    expect(AVISO_BABELBOT).toMatch(/inteligencia artificial/);
    expect(AVISO_BABELBOT).toMatch(/90 días/);
  });

  it('el aviso dice que la librería es la de Le Tiende', () => {
    expect(AVISO_BABELBOT).toContain('con la librería de Le Tiende.');
  });

  it('el aviso empieza expandido, se colapsa y se expande con el botón, y vuelve a empezar expandido al reabrir', async () => {
    await montar(true);
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(q('[data-testid="aviso-babelbot"]')).not.toBeNull();
    expect(q('[data-testid="alternar-aviso"]')?.getAttribute('aria-expanded')).toBe('true');

    q<HTMLButtonElement>('[data-testid="alternar-aviso"]')?.click();
    fixture.detectChanges();
    expect(q('[data-testid="aviso-babelbot"]')).toBeNull();
    expect(q('[data-testid="alternar-aviso"]')?.getAttribute('aria-expanded')).toBe('false');

    q<HTMLButtonElement>('[data-testid="alternar-aviso"]')?.click();
    fixture.detectChanges();
    expect(q('[data-testid="aviso-babelbot"]')).not.toBeNull();

    q<HTMLButtonElement>('[data-testid="alternar-aviso"]')?.click();
    q<HTMLButtonElement>('[aria-label="Cerrar BabelBot"]')?.click();
    fixture.detectChanges();
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(q('[data-testid="aviso-babelbot"]')).not.toBeNull();
  });

  it('pregunta, pinta la respuesta y la tarjeta del libro con datos de Babel (precio con formato, enlace a la ficha)', async () => {
    servicio.preguntar.mockResolvedValue(respuestaConLibro);
    await montar(true);
    await abrirYPreguntar('quiero una novela');
    expect(servicio.preguntar).toHaveBeenCalledWith([{ rol: 'usuario', texto: 'quiero una novela' }]);
    expect(el().textContent).toContain('quiero una novela');
    expect(el().textContent).toContain('Te sugiero este.');
    const tarjeta = q<HTMLAnchorElement>('a[href="/libro/b1"]');
    expect(tarjeta?.textContent).toContain('Libro Uno');
    expect(tarjeta?.textContent).toContain('Autora Uno');
    expect(tarjeta?.textContent).toContain('$45.000');
    expect(tarjeta?.textContent).toContain('Encaja con lo que pides.');
  });

  it('el texto del modelo se pinta como texto, nunca como HTML', async () => {
    servicio.preguntar.mockResolvedValue({
      exito: true,
      respuesta: { texto: '<img src=x onerror=alert(1)><b>negrita</b>', recomendaciones: [], sinResultados: true, registroId: null },
    });
    await montar(true);
    await abrirYPreguntar('hola');
    expect(el().querySelector('img[src="x"]')).toBeNull();
    expect(el().querySelector('b')).toBeNull();
    expect(el().textContent).toContain('<b>negrita</b>');
  });

  it('en la segunda pregunta reenvía el historial con los libros que recomendó antes', async () => {
    servicio.preguntar.mockResolvedValue(respuestaConLibro);
    await montar(true);
    await abrirYPreguntar('una novela');
    const caja = q<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
    caja.value = '¿cuánto cuesta?';
    caja.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLButtonElement>('button[type="submit"]')?.click();
    await fixture.whenStable();
    expect(servicio.preguntar).toHaveBeenLastCalledWith([
      { rol: 'usuario', texto: 'una novela' },
      { rol: 'asistente', texto: 'Te sugiero este.', libros: ['b1'] },
      { rol: 'usuario', texto: '¿cuánto cuesta?' },
    ]);
  });

  it('si falla, muestra el mensaje del servidor, quita la pregunta del historial y la devuelve a la caja para reenviarla', async () => {
    servicio.preguntar.mockResolvedValue({
      exito: false,
      motivo: 'saturado',
      mensaje: 'Hay mucha gente. «Paciencia y barajar», decía don Quijote.',
    });
    await montar(true);
    await abrirYPreguntar('una novela');
    expect(q('[data-testid="error-babelbot"]')?.textContent).toContain('Paciencia y barajar');
    expect((q('textarea') as HTMLTextAreaElement).value).toBe('una novela');
    // Reenviar tras el fallo no deja dos mensajes seguidos de la persona.
    servicio.preguntar.mockResolvedValue(respuestaConLibro);
    q<HTMLButtonElement>('button[type="submit"]')?.click();
    await fixture.whenStable();
    expect(servicio.preguntar).toHaveBeenLastCalledWith([{ rol: 'usuario', texto: 'una novela' }]);
  });

  it('no envía mensajes vacíos y deshabilita el envío mientras espera la respuesta', async () => {
    let resolver: (r: ResultadoPregunta) => void = () => undefined;
    servicio.preguntar.mockReturnValue(new Promise<ResultadoPregunta>((ok) => (resolver = ok)));
    await montar(true);
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(q<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    const caja = q<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
    caja.value = '   ';
    caja.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(q<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    caja.value = 'algo';
    caja.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    expect(q('[data-testid="pensando"]')).not.toBeNull();
    expect(q<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    resolver(respuestaConLibro);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(q('[data-testid="pensando"]')).toBeNull();
    expect(servicio.preguntar).toHaveBeenCalledTimes(1);
  });

  it('valora una respuesta con el pulgar, deja ver el agradecimiento y avisa si no se pudo guardar', async () => {
    servicio.preguntar.mockResolvedValue(respuestaConLibro);
    await montar(true);
    await abrirYPreguntar('una novela');
    q<HTMLButtonElement>('button[aria-label="Me sirvió esta respuesta"]')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(servicio.valorar).toHaveBeenCalledWith('r-1', 'positiva');
    expect(el().textContent).toContain('Gracias por tu opinión.');

    servicio.valorar.mockResolvedValue(false);
    q<HTMLButtonElement>('button[aria-label="No me sirvió esta respuesta"]')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain('No pude guardar tu valoración.');
  });

  it('una respuesta sin registroId no se puede valorar (no hay pulgares)', async () => {
    servicio.preguntar.mockResolvedValue({
      exito: true,
      respuesta: { texto: 'Hola.', recomendaciones: [], sinResultados: true, registroId: null },
    });
    await montar(true);
    await abrirYPreguntar('hola');
    expect(q('button[aria-label="Me sirvió esta respuesta"]')).toBeNull();
  });

  it('«Nueva conversación» vacía el historial', async () => {
    servicio.preguntar.mockResolvedValue(respuestaConLibro);
    await montar(true);
    await abrirYPreguntar('una novela');
    const nueva = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Nueva conversación')) as HTMLButtonElement;
    nueva.click();
    fixture.detectChanges();
    expect(el().textContent).not.toContain('Te sugiero este.');
  });

  it('se cierra con el botón de cerrar y con Escape', async () => {
    await montar(true);
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    q<HTMLButtonElement>('button[aria-label="Cerrar BabelBot"]')?.click();
    fixture.detectChanges();
    expect(q('[role="dialog"]')).toBeNull();
    q<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    q('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(q('[role="dialog"]')).toBeNull();
  });
});
