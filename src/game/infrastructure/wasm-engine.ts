// ─────────────────────────────────────────────────────────────────────────
// Infrastructure: WebAssembly engine adapter.
// Bridges the Rust single-threaded engine to the domain GameEnginePort and
// decodes its byte-serialised snapshot into domain entities.
//
// NOTE: the binary glue + types are produced by `npm run build:wasm`
// (wasm-pack --target web) into src/wasm-pkg/. The web-target glue is only
// imported from a client script (never from .astro frontmatter), so there is
// no Node-side WASM instantiation risk on SSR.
// ─────────────────────────────────────────────────────────────────────────
import type {
  GameEnginePort,
  GameSnapshot,
  GameStats,
  GameEntity,
  EntityKind,
  PlayerIntent,
} from '../domain/types';

import initWasm, {
  init as wasmInit,
  reset as wasmReset,
  step as wasmStep,
  score as wasmScore,
  lives as wasmLives,
  wave as wasmWave,
  game_over as wasmGameOver,
} from '../../wasm-pkg/space_invaders';

const ENTITY_FLOATS = 7;

export class WasmGameEngine implements GameEnginePort {
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.doInit();
    }
    return this.ready;
  }

  private async doInit(): Promise<void> {
    await initWasm();
    wasmInit();
  }

  step(dtMs: number, intent: PlayerIntent): GameSnapshot {
    const bytes = wasmStep(dtMs, intent.left, intent.right, intent.fire);
    return decodeSnapshot(bytes);
  }

  getStats(): GameStats {
    return {
      score: wasmScore(),
      lives: wasmLives(),
      wave: wasmWave(),
      gameOver: wasmGameOver(),
    };
  }

  reset(): void {
    wasmReset();
  }
}

function decodeSnapshot(bytes: Uint8Array): GameSnapshot {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  const score = view.getUint32(8, true);
  const lives = view.getUint32(12, true);
  const wave = view.getUint32(16, true);
  const gameOver = view.getUint32(20, true) === 1;
  const ufoActive = view.getUint32(24, true) === 1;

  const entities: GameEntity[] = [];
  let o = 28; // header is 7 × u32
  for (let i = 0; i < count; i++) {
    // kind is serialised as an f32 (K_INVADER=1.0, K_PLAYER=2.0, …)
    const kind = view.getFloat32(o, true) as EntityKind;
    const x = view.getFloat32(o + 4, true);
    const y = view.getFloat32(o + 8, true);
    const w = view.getFloat32(o + 12, true);
    const h = view.getFloat32(o + 16, true);
    const extra = view.getFloat32(o + 20, true);
    entities.push({ kind, x, y, w, h, extra });
    o += ENTITY_FLOATS * 4;
  }

  return { score, lives, wave, gameOver, ufoActive, entities };
}