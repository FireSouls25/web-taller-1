// ─────────────────────────────────────────────────────────────────────────
// Domain layer: pure types shared by every part of the game.
// No DOM, no WASM, no IO. These are the vocabulary of the game world.
// ─────────────────────────────────────────────────────────────────────────

/** Logical arena size in game units (the WASM engine uses the same). */
export const ARENA_W = 480;
export const ARENA_H = 620;

/** Entity kinds mirrored from the Rust engine snapshot. */
export enum EntityKind {
  Invader = 1,
  Player = 2,
  PlayerBullet = 3,
  EnemyBullet = 4,
  Ufo = 5,
}

/** One visible entity decoded from the WASM snapshot buffer. */
export interface GameEntity {
  kind: EntityKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** extra animation channel (invader flap, ufo direction) */
  extra: number;
}

/** Header + entities decoded from the Rust snapshot. */
export interface GameSnapshot {
  score: number;
  lives: number;
  wave: number;
  gameOver: boolean;
  ufoActive: boolean;
  entities: GameEntity[];
}

/** Raw player intent produced by the input adapter each frame. */
export interface PlayerIntent {
  left: boolean;
  right: boolean;
  fire: boolean;
}

export interface GameStats {
  score: number;
  lives: number;
  wave: number;
  gameOver: boolean;
}

/** Lifecycle phase of the game session (used by the orchestrator). */
export type GamePhase = 'loading' | 'running' | 'paused' | 'game-over' | 'error';

/** Ports: contracts the application layer depends on (dependency inversion). */

export interface GameEnginePort {
  init(): Promise<void>;
  step(dtMs: number, intent: PlayerIntent): GameSnapshot;
  getStats(): GameStats;
  reset(): void;
}

export interface RendererPort {
  mount(container: HTMLElement): void;
  draw(snapshot: GameSnapshot): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface AudioPort {
  init(): Promise<void>;
  shoot(): void;
  invaderHit(): void;
  playerHit(): void;
  ufoSpawned(): void;
  ufoHit(): void;
  waveStart(): void;
  gameOver(): void;
}

export interface MetricsPort {
  /** label a recognised long task on the main thread */
  recordLongTask(durationMs: number, attribution: string): void;
  onInteraction(entry: InteractionSample, target?: string): void;
  enable(): void;
  isEnabled(): boolean;
}

export interface InteractionSample {
  startTime: number;
  inputDelay: number;
  processingDuration: number;
  presentationDelay: number;
  total: number;
  type: string;
}