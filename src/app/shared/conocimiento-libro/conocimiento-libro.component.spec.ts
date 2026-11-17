import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConocimientoLibroComponent } from './conocimiento-libro.component';
import { crearGrupoConocimiento } from './conocimiento-libro.formulario';

@Component({
  imports: [ConocimientoLibroComponent],
  template: `<app-conocimiento-libro [grupo]="grupo" [fuente]="fuente()" idPrefijo="prueba" (sinopsisEditada)="ediciones = ediciones + 1" />`,
})
class AnfitrionComponent {
  grupo = crearGrupoConocimiento();
  fuente = signal<string | null>(null);
  ediciones = 0;
}

function montar() {
  const fixture = TestBed.createComponent(AnfitrionComponent);
  fixture.detectChanges();
  const detalles = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
  return { fixture, anfitrion: fixture.componentInstance, detalles };
}

describe('ConocimientoLibroComponent', () => {
  it('está plegado por defecto y se rotula como uso interno', () => {
    const { fixture, detalles } = montar();

    expect(detalles.open).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Datos para el asistente de recomendación (opcional)');
    expect(fixture.nativeElement.textContent).toContain('No se muestran al público');
  });

  it('usa el prefijo para los id (dos instancias nunca los repiten)', () => {
    const { fixture } = montar();

    expect(fixture.nativeElement.querySelector('#pruebaSinopsis')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#pruebaCategorias')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#pruebaIdioma')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#pruebaPaginas')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#pruebaEdad')).toBeTruthy();
  });

  it('muestra la fuente de la sinopsis solo si la hay', () => {
    const { fixture, anfitrion } = montar();
    expect(fixture.nativeElement.textContent).not.toContain('Fuente:');

    anfitrion.fuente.set('google-books');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Fuente: Google Books');
  });

  it('emite sinopsisEditada solo cuando la persona escribe, no cuando se cambia el valor por código', () => {
    const { fixture, anfitrion } = montar();

    anfitrion.grupo.controls.sinopsis.setValue('puesta por código');
    fixture.detectChanges();
    expect(anfitrion.ediciones).toBe(0);

    const textarea = fixture.nativeElement.querySelector('#pruebaSinopsis') as HTMLTextAreaElement;
    textarea.value = 'escrita por la persona';
    textarea.dispatchEvent(new Event('input'));

    expect(anfitrion.ediciones).toBe(1);
    expect(anfitrion.grupo.controls.sinopsis.value).toBe('escrita por la persona');
  });

  it('se abre solo cuando un campo tiene un error visible, y muestra el mensaje', () => {
    const { fixture, anfitrion, detalles } = montar();

    anfitrion.grupo.controls.idioma.setValue('<x>');
    anfitrion.grupo.markAllAsTouched();
    fixture.detectChanges();

    expect(detalles.open).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Usa un código como');
  });

  it('muestra el texto de la sinopsis como texto, nunca como HTML (A03)', () => {
    const { fixture, anfitrion } = montar();

    anfitrion.grupo.controls.sinopsis.setValue('<img src=x onerror=alert(1)><b>negrita</b>');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('details b')).toBeNull();
    const textarea = fixture.nativeElement.querySelector('#pruebaSinopsis') as HTMLTextAreaElement;
    expect(textarea.value).toBe('<img src=x onerror=alert(1)><b>negrita</b>');
  });
});
