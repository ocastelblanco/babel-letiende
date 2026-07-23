import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminInicioComponent } from './admin-inicio.component';

describe('AdminInicioComponent', () => {
  let fixture: ComponentFixture<AdminInicioComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminInicioComponent], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(AdminInicioComponent);
    fixture.detectChanges();
  });

  it('muestra el título de administración', () => {
    expect(fixture.nativeElement.textContent).toContain('Administración');
  });

  it('lista las 5 secciones', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Estantes');
    expect(texto).toContain('Usuarios');
    expect(texto).toContain('Editoriales');
    expect(texto).toContain('Sitios de scraping');
    expect(texto).toContain('Reportes');
  });

  it('enlaza la sección Estantes a /admin/estantes', () => {
    const enlace = fixture.nativeElement.querySelector('a[href="/admin/estantes"]') as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
  });

  it('enlaza la sección Sitios de scraping a /admin/sitios', () => {
    const enlace = fixture.nativeElement.querySelector('a[href="/admin/sitios"]') as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
  });

  it('enlaza la sección Usuarios a /admin/usuarios', () => {
    const enlace = fixture.nativeElement.querySelector('a[href="/admin/usuarios"]') as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
  });

  it('enlaza la sección Editoriales a /admin/editoriales', () => {
    const enlace = fixture.nativeElement.querySelector('a[href="/admin/editoriales"]') as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
  });

  it('enlaza la sección Reportes a /admin/reportes', () => {
    const enlace = fixture.nativeElement.querySelector('a[href="/admin/reportes"]') as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
  });
});
