// ─────────────────────────────────────────────────────────────────────────
// Infrastructure: keyboard input adapter.
// Keyboard events arrive as TASKS on the main thread (input event listeners).
// We only mutate a tiny state object here so the per-frame update reads it
// synchronously inside the next rAF task, without scheduling work that could
// ever block the event loop. Keys: ←/→ (or A/D), Space/Z (fire), R (restart).
// ─────────────────────────────────────────────────────────────────────────
import type { PlayerIntent } from '../domain/types';

const KEY_LEFT = ['ArrowLeft', 'KeyA'];
const KEY_RIGHT = ['ArrowRight', 'KeyD'];
const KEY_FIRE = ['Space', 'KeyZ', 'KeyX'];

export class KeyboardInput {
  private keys = new Set<string>();
  private firedThisFrame = false;

  /** Call after construcing to bind listeners (returns an unbound function). */
  bind(onFire?: () => void, onRestart?: () => void): () => void {
    const down = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const isGameKey =
        KEY_LEFT.includes(e.code) ||
        KEY_RIGHT.includes(e.code) ||
        KEY_FIRE.includes(e.code) ||
        e.code === 'KeyR';
      if (isGameKey) e.preventDefault();
      if (e.code === 'KeyR') {
        onRestart?.();
        return;
      }
      this.keys.add(e.code);
      if (KEY_FIRE.includes(e.code)) {
        this.firedThisFrame = true;
        onFire?.();
      }
    };
    const up = (e: KeyboardEvent): void => {
      this.keys.delete(e.code);
    };
    const blur = (): void => {
      this.keys.clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }

  /**
   * Sample intent for the current frame. Edge-triggered fire: once `fire` is
   * consumed by the tick that owns the frame it is reset.
   */
  sample(): PlayerIntent {
    const fired = this.firedThisFrame;
    this.firedThisFrame = false;
    return {
      left: this.keys.has(KEY_LEFT[0]) || this.keys.has(KEY_LEFT[1]),
      right: this.keys.has(KEY_RIGHT[0]) || this.keys.has(KEY_RIGHT[1]),
      fire: fired,
    };
  }

  /** Allows the runner to fire programmatically (e.g. touch UI buttons). */
  pressFire(): void {
    if (!this.keys.has('Space')) {
      this.keys.add('Space');
      this.firedThisFrame = true;
    }
  }

  releaseAll(): void {
    this.keys.clear();
  }
}