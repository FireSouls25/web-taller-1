// ─────────────────────────────────────────────────────────────────────────
// Infrastructure: Canvas renderer.
// Draws the arena + every entity from the WASM snapshot using procedural
// pixel-art sprites (no external image assets required). Rendering happens
// once per animation frame inside the read-and-draw part of the loop.
// ─────────────────────────────────────────────────────────────────────────
import type { GameSnapshot, GameEntity, RendererPort } from '../domain/types';
import { EntityKind, ARENA_W, ARENA_H } from '../domain/types';

// ── procedural 8-bit sprites (bitmask rows, '#'=pixel) ──────────────────
const SPRITE_CRAB: string[][] = [
  ['..#..#..'],
  ['#.#..#.#'],
  ['########'],
  ['#.####.#'],
  ['.######.'],
  ['..#..#..'],
  ['.#.##.#.'],
];

const SPRITE_SQUID: string[][] = [
  ['...##...'],
  ['..####..'],
  ['.######.'],
  ['########'],
  ['#.##.##.'],
  ['#.##.##.'],
  ['..####..'],
];

const SPRITE_SPIDER: string[][] = [
  ['........'],
  ['..#..#..'],
  ['##.##.##'],
  ['.######.'],
  ['##.##.##'],
  ['.....#..'],
  ['..#....#'],
];

const SPRITE_PLAYER: string[][] = [
  ['..#..#..#..'],
  ['##########'],
  ['##########'],
  ['.########.'],
  ['..#.#.#...'],
];

function drawSprite(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  glow = true,
): void {
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
  } else {
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = color;
  const cell = Math.min(w / rows[0].length, h / rows.length);
  const offx = x + (w - rows[0].length * cell) / 2;
  const offy = y + (h - rows.length * cell) / 2;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === '#') {
        ctx.fillRect(offx + c * cell, offy + r * cell, cell, cell);
      }
    }
  }
  ctx.shadowBlur = 0;
}

export class CanvasRenderer implements RendererPort {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private containerW = 0;
  private containerH = 0;

  mount(container: HTMLElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = ARENA_W * 2;
    canvas.height = ARENA_H * 2;
    canvas.setAttribute('aria-label', 'Space Invaders game area');
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize(container.clientWidth, container.clientHeight);
  }

  resize(width: number, height: number): void {
    this.containerW = width;
    this.containerH = height;
    if (this.canvas) {
      this.canvas.style.width = Math.min(width, this.containerW) + 'px';
      this.canvas.style.height = Math.min(height, this.containerH) + 'px';
    }
  }

  draw(snapshot: GameSnapshot): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;

    // Scale canvas backing store so ARENA_W×ARENA_H fits the container.
    const scale = Math.min(
      this.canvas.width / ARENA_W,
      this.canvas.height / ARENA_H,
    );

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // Background
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // Starfield
    ctx.fillStyle = '#1c2333';
    drawStars(ctx, snapshot.wave);

    // Entities
    for (const e of snapshot.entities) {
      switch (e.kind) {
        case EntityKind.Invader:
          this.drawInvader(ctx, e);
          break;
        case EntityKind.Player:
          this.drawPlayer(ctx, e);
          break;
        case EntityKind.PlayerBullet:
          this.drawPlayerBullet(ctx, e);
          break;
        case EntityKind.EnemyBullet:
          this.drawEnemyBullet(ctx, e);
          break;
        case EntityKind.Ufo:
          this.drawUfo(ctx, e);
          break;
        default:
          break;
      }
    }

    ctx.restore();
  }

  private drawInvader(ctx: CanvasRenderingContext2D, e: GameEntity): void {
    // flap: alternate crab/squid/spider by wave proximity visually via extra
    const anim = Math.floor(e.extra % 3);
    const sprite =
      anim === 0 ? SPRITE_CRAB : anim === 1 ? SPRITE_SQUID : SPRITE_SPIDER;
    const color = anim === 2 ? '#c14bff' : anim === 1 ? '#ffd23f' : '#3bff8f';
    drawSprite(ctx, sprite.map((r) => r[0]), e.x, e.y, e.w, e.h, color);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, e: GameEntity): void {
    drawSprite(ctx, SPRITE_PLAYER.map((r) => r[0]), e.x, e.y, e.w, e.h, '#3bc2ff');
  }

  private drawPlayerBullet(ctx: CanvasRenderingContext2D, e: GameEntity): void {
    ctx.shadowColor = '#3bff8f';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#eafff7';
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.shadowBlur = 0;
  }

  private drawEnemyBullet(ctx: CanvasRenderingContext2D, e: GameEntity): void {
    ctx.shadowColor = '#ff5c5c';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffd0d0';
    ctx.beginPath();
    ctx.arc(e.x + e.w / 2, e.y + e.h / 2, Math.max(e.w, e.h) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private drawUfo(ctx: CanvasRenderingContext2D, e: GameEntity): void {
    // diamond-shaped UFO
    ctx.shadowColor = '#ff6bd6';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff9be8';
    ctx.beginPath();
    ctx.moveTo(e.x + e.w / 2, e.y);
    ctx.lineTo(e.x + e.w, e.y + e.h / 2);
    ctx.lineTo(e.x + e.w / 2, e.y + e.h);
    ctx.lineTo(e.x, e.y + e.h / 2);
    ctx.closePath();
    ctx.fill();
    // lights
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(e.x + e.w * (0.2 + i * 0.3), e.y + e.h / 2 - 1, 3, 2);
    }
    ctx.shadowBlur = 0;
  }

  dispose(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}

let starSeed = 0;
function drawStars(ctx: CanvasRenderingContext2D, wave: number): void {
  // deterministic pseudo-random stars per wave so it's stable per session
  const count = 90;
  let seed = (wave * 2654435761 + starSeed) >>> 0;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = (seed % ARENA_W);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = (seed % ARENA_H);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const s = (seed % 10) / 10 + 0.5;
    ctx.globalAlpha = 0.2 + s * 0.3;
    ctx.fillStyle = '#8ba0c8';
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  void starSeed;
}