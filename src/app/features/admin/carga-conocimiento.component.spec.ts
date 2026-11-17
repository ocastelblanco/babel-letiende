import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CargaConocimientoService } from '../../core/api/carga-conocimiento.service';
import type { ResumenCargaConocimiento } from '../../core/models/carga-conocimiento.model';
import { CargaConocimientoComponent } from './carga-conocimiento.component';

const completada: ResumenCargaConocimiento = {
  cargaId: 'c-1',
  estado: 'completado',
  iniciadoPor: 'admin@letiende.co',
  iniciadoEn: '2026-01-01T00:00:00.000Z',
  actualizadoEn: '2026-01-01T00:00:00.000Z',
  indiceActual: 10,
  totalLibros: 10,
  librosRevisados: 10,
  guardados: 6,
  yaTenian: 1,
  sinIsbn: 1,
  sinDatos: 2,
  errores: 0,
  conSinopsisUtil: 5,
  conSinopsisCorta: 1,
  sinSinopsis: 4,
  porIdioma: { es: { total: 6, utiles: 4 }, en: { total: 1, utiles: 1 }, desconocido: { total: 3, utiles: 0 } },
  porFuente: { 'sitio:tornamesa.co': { total: 4, utiles: 4 }, 'sin-sinopsis': { total: 4, utiles: 0 } },
};

describe('CargaConocimientoComponent', () => {
  let fixture: ComponentFixture<CargaConocimientoComponent>;
  const iniciar = vi.fn();
  const consultar = vi.fn();

  function crear() {
    TestBed.configureTestingModule({
      imports: [CargaConocimientoComponent],
      providers: [{ provide: CargaConocimientoService, useValue: { iniciar, consultar } }],
    });
    fixture = TestBed.createComponent(CargaConocimientoComponent);
    fixture.detectChanges();
  }

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const boton = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('al iniciar consulta el avance y muestra la cobertura por idioma y fuente', async () => {
    iniciar.mockResolvedValue({ iniciada: true, cargaId: 'c-1' });
    consultar.mockResolvedValue(completada);
    crear();
    boton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(consultar).toHaveBeenCalledWith('c-1');
    expect(texto()).toContain('Carga completada');
    expect(texto()).toContain('10 de 10 libros (100 %)');
    expect(texto()).toContain('sitio:tornamesa.co');
    expect(texto()).toContain('desconocido');
    expect(texto()).toContain('Sinopsis útil');
  });

  it('un 409 retoma la carga en curso en vez de mostrar un error', async () => {
    iniciar.mockResolvedValue({ iniciada: false, cargaIdEnCurso: 'c-9', error: 'Ya hay una carga en curso.' });
    consultar.mockResolvedValue({ ...completada, cargaId: 'c-9', estado: 'completado' });
    crear();
    boton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(consultar).toHaveBeenCalledWith('c-9');
    expect(texto()).not.toContain('Ya hay una carga en curso.');
  });

  it('muestra el error del backend si no se pudo iniciar', async () => {
    iniciar.mockResolvedValue({ iniciada: false, cargaIdEnCurso: null, error: 'No autorizado' });
    crear();
    boton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto()).toContain('No autorizado');
    expect(consultar).not.toHaveBeenCalled();
  });

  it('si se pierde la conexión con la carga, avisa y deja reintentar', async () => {
    iniciar.mockResolvedValue({ iniciada: true, cargaId: 'c-1' });
    consultar.mockResolvedValue(null);
    crear();
    boton().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto()).toContain('Se perdió la conexión');
    expect(boton().disabled).toBe(false);
  });
});
