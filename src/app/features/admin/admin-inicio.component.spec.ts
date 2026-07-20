import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminInicioComponent } from './admin-inicio.component';

describe('AdminInicioComponent', () => {
  let fixture: ComponentFixture<AdminInicioComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminInicioComponent] });
    fixture = TestBed.createComponent(AdminInicioComponent);
    fixture.detectChanges();
  });

  it('muestra el título de administración', () => {
    expect(fixture.nativeElement.textContent).toContain('Administración');
  });

  it('lista las 4 secciones futuras', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Estantes');
    expect(texto).toContain('Usuarios');
    expect(texto).toContain('Editoriales');
    expect(texto).toContain('Reportes');
  });
});
