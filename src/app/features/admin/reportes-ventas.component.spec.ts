import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LibrosService } from '../../core/api/libros.service';
import { FiltrosExportarVentas, VentasService } from '../../core/api/ventas.service';
import { ReportesVentasComponent } from './reportes-ventas.component';

function configurarPrueba(
  resultado: { exito: true } | { exito: false; error: string } = { exito: true },
  resultadoInventario: { exito: true } | { exito: false; error: string } = { exito: true },
  resultadoRepetidos: { exito: true } | { exito: false; error: string } = { exito: true },
) {
  const exportarVentasMock = vi.fn().mockResolvedValue(resultado);
  const exportarInventarioMock = vi.fn().mockResolvedValue(resultadoInventario);
  const exportarRepetidosMock = vi.fn().mockResolvedValue(resultadoRepetidos);

  TestBed.configureTestingModule({
    providers: [
      { provide: VentasService, useValue: { exportarVentas: exportarVentasMock } },
      {
        provide: LibrosService,
        useValue: { exportarInventario: exportarInventarioMock, exportarRepetidos: exportarRepetidosMock },
      },
    ],
  });

  const fixture: ComponentFixture<ReportesVentasComponent> = TestBed.createComponent(ReportesVentasComponent);
  fixture.detectChanges();

  return { fixture, exportarVentasMock, exportarInventarioMock, exportarRepetidosMock };
}

function botonExportar(fixture: ComponentFixture<ReportesVentasComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function llenarFormulario(
  fixture: ComponentFixture<ReportesVentasComponent>,
  valores: Partial<{ desde: string; hasta: string; editorial: string; formaDePago: string }>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fixture.componentInstance as any).formulario.patchValue(valores);
}

function enviarFormulario(fixture: ComponentFixture<ReportesVentasComponent>) {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

describe('ReportesVentasComponent', () => {
  it('muestra el formulario de filtros sin listar ventas', () => {
    const { fixture } = configurarPrueba();

    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Reportes de ventas');
    expect(fixture.nativeElement.textContent).not.toContain('Exportando…');
  });

  it('llama a exportarVentas sin filtros cuando el formulario está vacío', async () => {
    const { fixture, exportarVentasMock } = configurarPrueba();

    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(exportarVentasMock).toHaveBeenCalledWith({});
    expect(fixture.nativeElement.textContent).toContain('Reporte exportado correctamente.');
  });

  it('llama a exportarVentas con los filtros dados, normalizando desde/hasta a ISO completo', async () => {
    const { fixture, exportarVentasMock } = configurarPrueba();

    llenarFormulario(fixture, {
      desde: '2026-07-01',
      hasta: '2026-07-31',
      editorial: '  Planeta  ',
      formaDePago: 'efectivo',
    });
    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(exportarVentasMock).toHaveBeenCalledWith({
      desde: '2026-07-01T00:00:00.000Z',
      hasta: '2026-07-31T23:59:59.999Z',
      editorial: 'Planeta',
      formaDePago: 'efectivo',
    } satisfies FiltrosExportarVentas);
  });

  it('muestra el estado de carga mientras exporta', async () => {
    let resolver!: (valor: { exito: true }) => void;
    const exportarVentasMock = vi.fn().mockReturnValue(new Promise((resolve) => (resolver = resolve)));
    TestBed.configureTestingModule({
      providers: [
        { provide: VentasService, useValue: { exportarVentas: exportarVentasMock } },
        { provide: LibrosService, useValue: { exportarInventario: vi.fn() } },
      ],
    });
    const fixture: ComponentFixture<ReportesVentasComponent> = TestBed.createComponent(ReportesVentasComponent);
    fixture.detectChanges();

    enviarFormulario(fixture);
    await Promise.resolve();
    fixture.detectChanges();

    expect(botonExportar(fixture).disabled).toBe(true);
    expect(botonExportar(fixture).textContent).toContain('Exportando…');

    resolver({ exito: true });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(botonExportar(fixture).disabled).toBe(false);
  });

  it('muestra un mensaje de error cuando exportarVentas falla', async () => {
    const { fixture } = configurarPrueba({
      exito: false,
      error: 'Este correo no está autorizado para exportar reportes de ventas en Babel.',
    });

    enviarFormulario(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Este correo no está autorizado para exportar reportes de ventas en Babel.',
    );
  });

  describe('reporte de inventario', () => {
    /**
     * Localiza por POSICIÓN en el DOM (siempre el primero de los `type="button"`,
     * en el orden fijo en que aparecen en la plantilla: inventario, luego
     * repetidos) — no por texto, que cambia a "Exportando…" mientras carga, ni
     * por "el último", que dejó de identificar a este botón al agregar el
     * tercer bloque (repetidos).
     */
    function botonExportarInventario(fixture: ComponentFixture<ReportesVentasComponent>): HTMLButtonElement {
      const botones = fixture.nativeElement.querySelectorAll('button[type="button"]') as NodeListOf<HTMLButtonElement>;
      return botones[0] as HTMLButtonElement;
    }

    it('muestra la sección de reporte de inventario', () => {
      const { fixture } = configurarPrueba();

      expect(fixture.nativeElement.textContent).toContain('Reporte de inventario');
    });

    it('llama a exportarInventario al hacer click en el botón', async () => {
      const { fixture, exportarInventarioMock } = configurarPrueba();

      botonExportarInventario(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(exportarInventarioMock).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.textContent).toContain('Inventario exportado correctamente.');
    });

    it('muestra el estado de carga mientras exporta el inventario, independiente del reporte de ventas', async () => {
      let resolver!: (valor: { exito: true }) => void;
      const exportarInventarioMock = vi.fn().mockReturnValue(new Promise((resolve) => (resolver = resolve)));
      TestBed.configureTestingModule({
        providers: [
          { provide: VentasService, useValue: { exportarVentas: vi.fn() } },
          { provide: LibrosService, useValue: { exportarInventario: exportarInventarioMock } },
        ],
      });
      const fixture: ComponentFixture<ReportesVentasComponent> = TestBed.createComponent(ReportesVentasComponent);
      fixture.detectChanges();

      botonExportarInventario(fixture).click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(botonExportarInventario(fixture).disabled).toBe(true);
      expect(botonExportarInventario(fixture).textContent).toContain('Exportando…');
      expect(botonExportar(fixture).disabled).toBe(false);

      resolver({ exito: true });
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(botonExportarInventario(fixture).disabled).toBe(false);
    });

    it('muestra un mensaje de error cuando exportarInventario falla', async () => {
      const { fixture } = configurarPrueba(
        { exito: true },
        { exito: false, error: 'Este correo no está autorizado para exportar el inventario en Babel.' },
      );

      botonExportarInventario(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Este correo no está autorizado para exportar el inventario en Babel.',
      );
    });
  });

  describe('reporte de libros repetidos', () => {
    /** El segundo (y último) `type="button"` en el orden fijo de la plantilla — ver nota de `botonExportarInventario` arriba. */
    function botonExportarRepetidos(fixture: ComponentFixture<ReportesVentasComponent>): HTMLButtonElement {
      const botones = fixture.nativeElement.querySelectorAll('button[type="button"]') as NodeListOf<HTMLButtonElement>;
      return botones[1] as HTMLButtonElement;
    }

    it('muestra la sección de reporte de libros repetidos', () => {
      const { fixture } = configurarPrueba();

      expect(fixture.nativeElement.textContent).toContain('Reporte de libros repetidos');
    });

    it('llama a exportarRepetidos al hacer click en el botón', async () => {
      const { fixture, exportarRepetidosMock } = configurarPrueba();

      botonExportarRepetidos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(exportarRepetidosMock).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.textContent).toContain('Reporte de repetidos exportado correctamente.');
    });

    it('muestra el estado de carga mientras exporta repetidos, independiente de los otros dos reportes', async () => {
      let resolver!: (valor: { exito: true }) => void;
      const exportarRepetidosMock = vi.fn().mockReturnValue(new Promise((resolve) => (resolver = resolve)));
      TestBed.configureTestingModule({
        providers: [
          { provide: VentasService, useValue: { exportarVentas: vi.fn() } },
          { provide: LibrosService, useValue: { exportarInventario: vi.fn(), exportarRepetidos: exportarRepetidosMock } },
        ],
      });
      const fixture: ComponentFixture<ReportesVentasComponent> = TestBed.createComponent(ReportesVentasComponent);
      fixture.detectChanges();

      botonExportarRepetidos(fixture).click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(botonExportarRepetidos(fixture).disabled).toBe(true);
      expect(botonExportarRepetidos(fixture).textContent).toContain('Exportando…');
      expect(botonExportar(fixture).disabled).toBe(false);

      resolver({ exito: true });
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(botonExportarRepetidos(fixture).disabled).toBe(false);
    });

    it('muestra un mensaje de error cuando exportarRepetidos falla', async () => {
      const { fixture } = configurarPrueba(
        { exito: true },
        { exito: true },
        { exito: false, error: 'Este correo no está autorizado para exportar este reporte en Babel.' },
      );

      botonExportarRepetidos(fixture).click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Este correo no está autorizado para exportar este reporte en Babel.',
      );
    });
  });
});
