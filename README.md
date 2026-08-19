# Taller 1 — Space Invaders

Clon de Space Invaders construido con Astro + TypeScript vanilla + Rust (WASM).

## Tecnología

- **Astro 7** — generación estática del sitio (SSR shell sin JS en el HTML base).
- **TypeScript vanilla** — frontend con arquitectura limpia:
  - `domain` : tipos y puertos puros
  - `application` : lógica de la aplicación (`GameRunner`, demo de estrés)
  - `infrastructure` : motor, render, audio, input, scheduler y métricas
  - `presentation` : HUD
- **Rust → WASM** — motor del juego en Rust compilado a WebAssembly (un solo hilo, sin `SharedArrayBuffer`). Generado con `cargo build --release --target wasm32-unknown-unknown` + `wasm-bindgen --target web` (sin wasm-pack).
- **Assets procedurales** — sprites dibujados con Canvas y efectos de sonido sintetizados con WebAudio. Sin archivos externos.
- **Event Loop / INP** — programador de tareas/microtasks/`yield`, observadores de *Long Task* y *Event Timing*, y métricas de INP con `web-vitals/attribution`. Panel seleccionable por dropdown.

## Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build estático de producción a `dist/` |
| `npm run preview` | Previsualizar el build |
| `npm run build:wasm` | Recompilar el motor Rust a `src/wasm-pkg/` |
| `npm run typecheck` | `astro check` (TypeScript) |

> `build:wasm` usa wasm-pack; si no está instalado, compilar manualmente:
> `cd wasm && cargo build --release --target wasm32-unknown-unknown && wasm-bindgen --target web --out-dir ../src/wasm-pkg --out-name space_invaders target/wasm32-unknown-unknown/release/space_invaders.wasm`

## Despliegue

Build estático de Astro: compatible con Vercel, Netlify y Cloudflare Pages sin configuración extra. Los artefactos WASM (`src/wasm-pkg/`) están versionados para que el build del hoster funcione sin toolchain de Rust.
