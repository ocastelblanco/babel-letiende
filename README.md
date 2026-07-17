<hr>

<div align="center">

<h1 align="center">Babel</h1>

</div>

<pre align="center">Catalogación, ubicación y venta del inventario de libros de Le Tiende</pre>

![Status](https://img.shields.io/badge/estado-en%20arranque-yellow) ![License](https://img.shields.io/badge/license-MIT-blue) [![SLIM](https://img.shields.io/badge/Best%20Practices%20from-SLIM-blue)](https://nasa-ammos.github.io/slim/)

Babel es la aplicación interna del centro cultural **Le Tiende** (Bogotá, Colombia) para catalogar, ubicar y vender el inventario físico de su librería. Permite a los vendedores escanear el código de barras (ISBN) de un libro, completar automáticamente sus datos (autor, portada, editorial, precio de venta al público) y asignarle un estante; registrar la venta de un libro en pocos toques; y, para el administrador, generar reportes financieros y configurar catálogo, usuarios, estantes y descuentos editoriales. También expone un catálogo público de consulta, sin necesidad de autenticación.

El caso de uso fundacional es catalogar un inventario inicial de **más de 3.000 libros**, por lo que el flujo de catalogación es la ruta crítica de rendimiento de todo el sistema.

[PRD](PRD.md) | [Especificaciones técnicas](tech-specs.md) | [TODO / roadmap activo](TODO.md) | [Memoria de proyecto](MEMORY.md)

## Features

* Catalogación de libros por escaneo de ISBN, con precarga automática y editable de autor, portada, editorial y PVP
* Ubicación física del libro en un estante configurable
* Registro de venta en pocos toques desde el celular
* Catálogo público de consulta (sin autenticación), indexable vía SSR
* Reportes financieros exportables en XLSX (filtrables por fecha, PVP, utilidad, costo, editorial, forma de pago)
* Panel de administración: usuarios, estantes, descuentos editoriales
* Autenticación con Google (Firebase Authentication), con roles `administrador` / `vendedor` propios de Babel

## Estado del proyecto

Babel está en **fase de arranque**: la documentación de producto y arquitectura (`PRD.md`, `tech-specs.md`) ya existe, pero el código de la aplicación todavía no. Las tareas activas del scaffold inicial (proyecto Angular y esqueleto de infraestructura serverless) están descritas en [`TODO.md`](TODO.md).

## Contents

* [Stack tecnológico](#stack-tecnológico)
* [Quick Start](#quick-start)
* [Seguridad](#seguridad)
* [Contributing](#contributing)
* [License](#license)
* [Support](#support)

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Angular 22.x (standalone components, Signals, SSR con `@angular/ssr`) |
| Estilos | Tailwind CSS 4.x |
| Backend | Node.js 24.x en AWS Lambda + API Gateway (IaC con Serverless Framework) |
| Base de datos | AWS DynamoDB |
| Autenticación | Google Firebase Authentication (proyecto compartido con Comandante, roles independientes) |
| Metadatos de libros | API propia `https://api.letiende.co` (proxy sobre Google Books API) |
| Reportes | `xlsx` |
| Código de barras | Librería web basada en `getUserMedia` (`@zxing/browser` o `html5-qrcode`) |
| Costo de infraestructura objetivo | $0 (capa gratuita de AWS) |

Ver el detalle completo en [`tech-specs.md`](tech-specs.md) y [`CLAUDE.md`](CLAUDE.md).

## Quick Start

> Los comandos de abajo son la referencia esperada una vez exista `package.json` (Tarea 1 de [`TODO.md`](TODO.md)); todavía no aplican mientras el scaffold de Angular no se haya generado.

### Requisitos

* Node.js 24.x
* Cuenta de AWS (para despliegue de Lambda/DynamoDB)
* Proyecto Firebase compartido con Comandante (Authentication)

### Setup

```bash
git clone https://github.com/ocastelblanco/babel-letiende.git
cd babel-letiende
npm install
```

### Ejecutar en desarrollo

```bash
npm run start          # servidor de desarrollo local (ng serve)
```

### Build de producción (SSR)

```bash
npm run build -- --configuration=production
npm run serve:ssr
```

### Tests

```bash
npm run test
```

### Despliegue

```bash
npx serverless deploy --stage staging
npx serverless deploy --stage production
```

## Seguridad

Babel sigue las reglas OWASP documentadas en [`CLAUDE.md`](CLAUDE.md#5-seguridad-owasp): autorización siempre resuelta en el backend (nunca en un rol enviado por el cliente), scraping restringido a lista blanca de dominios, sanitización de cualquier dato externo antes de renderizarlo, y gestión de secretos vía variables de entorno (nunca commiteados).

## Contributing

Este repositorio sigue un flujo de Git estricto (ver [`CLAUDE.md`](CLAUDE.md#6-git-flow-para-agentes-ia)): todo cambio llega a `main` únicamente vía Pull Request revisado por un humano, nunca por commit o push directo.

1. Crea una rama `feature/*`, `fix/*`, `docs/*`, `hotfix/*` o `refactor/*` desde `main`
2. Haz tus cambios y confirma que `npm run build` pasa sin errores
3. Abre un Pull Request contra `main` describiendo los cambios y cómo probarlos

## License

Ver [LICENSE](LICENSE) (MIT).

## Support

Punto de contacto: [@ocastelblanco](https://github.com/ocastelblanco)
