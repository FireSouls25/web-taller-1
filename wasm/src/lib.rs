use wasm_bindgen::prelude::*;
use std::cell::RefCell;

// ─────────────────────────────────────────────────────────────────────────
// Single-threaded Space Invaders logic engine.
// Owns the entire game state, advances it in `step()` and serialises a
// snapshot of visible entities into a byte buffer the JS side renders.
// No threading, no SharedArrayBuffer: everything runs on the page's main
// thread from inside the rAF task (see src/game/.../FrameScheduler).
// ─────────────────────────────────────────────────────────────────────────

const ARENA_W: f32 = 480.0;
const ARENA_H: f32 = 620.0;
const PL_W: f32 = 46.0;
const PL_H: f32 = 18.0;
const PL_SPEED: f32 = 300.0;
const INV_W: f32 = 36.0;
const INV_H: f32 = 26.0;
const COLS: usize = 11;
const ROWS: usize = 5;
const GRID_TOP: f32 = 46.0;
const GRID_DX: f32 = 42.0;
const GRID_DY: f32 = 34.0;
const INV_SPEED: f32 = 34.0;
const DESCEND: f32 = 26.0;
const BULLET_W: f32 = 4.0;
const BULLET_H: f32 = 13.0;
const FIRE_CD: f32 = 0.24;
const ENEMY_SHOT_BASE: f32 = 1.6;
const MAX_BULLETS: usize = 96;

// Snapshot entity kinds
const K_INVADER: f32 = 1.0;
const K_PLAYER: f32 = 2.0;
const K_PBULLET: f32 = 3.0;
const K_EBULLET: f32 = 4.0;
const K_UFO: f32 = 5.0;

#[derive(Clone, Copy, Default)]
struct Invader {
    x: f32,
    y: f32,
    alive: bool,
}

struct Bullet {
    x: f32,
    y: f32,
    v: f32,
    from_player: bool,
    w: f32,
    h: f32,
}

struct State {
    player_x: f32,
    invaders: Vec<Invader>,
    bullets: Vec<Bullet>,
    score: u32,
    lives: u32,
    wave: u32,
    game_over: bool,
    dir: f32,
    speed: f32,
    fire_cd: f32,
    enemy_shot_cd: f32,
    flap_time: f32,
    rng: u32,
    ufo: Option<(f32, f32)>,
    ufo_cd: f32,
}

impl State {
    fn new() -> Self {
        Self {
            player_x: ARENA_W / 2.0 - PL_W / 2.0,
            invaders: Vec::new(),
            bullets: Vec::new(),
            score: 0,
            lives: 3,
            wave: 1,
            game_over: false,
            dir: 1.0,
            speed: INV_SPEED,
            fire_cd: 0.0,
            enemy_shot_cd: ENEMY_SHOT_BASE,
            flap_time: 0.0,
            rng: 0x9e3779b9,
            ufo: None,
            ufo_cd: 6.0,
        }
    }

    fn spawn_grid(&mut self) {
        self.invaders.clear();
        let w = ((COLS as f32 - 1.0) * GRID_DX + INV_W) / 2.0;
        for row in 0..ROWS {
            for col in 0..COLS {
                self.invaders.push(Invader {
                    x: ARENA_W / 2.0 - w + col as f32 * GRID_DX,
                    y: GRID_TOP + row as f32 * GRID_DY,
                    alive: true,
                });
            }
        }
    }

    fn rand(&mut self) -> u32 {
        // xorshift32 – deterministic, no external crate
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        x
    }

    fn bottom_most_alive(&mut self) -> Option<(usize, f32, f32)> {
        let mut best: Vec<(usize, f32, f32)> = Vec::new();
        for col in 0..COLS {
            let mut pick: Option<(usize, f32, f32)> = None;
            for row in 0..ROWS {
                let idx = row * COLS + col;
                if self.invaders[idx].alive {
                    pick = Some((
                        idx,
                        self.invaders[idx].x + INV_W / 2.0,
                        self.invaders[idx].y + INV_H,
                    ));
                }
            }
            if let Some(p) = pick {
                best.push(p);
            }
        }
        if best.is_empty() {
            None
        } else {
            let i = self.rand() % best.len() as u32;
            Some(best[i as usize])
        }
    }

    fn grid_bounds(&self) -> Option<(f32, f32)> {
        let mut min = f32::INFINITY;
        let mut max = f32::NEG_INFINITY;
        for inv in &self.invaders {
            if !inv.alive {
                continue;
            }
            if inv.x < min {
                min = inv.x;
            }
            if inv.x + INV_W > max {
                max = inv.x + INV_W;
            }
        }
        if min.is_finite() && max.is_finite() {
            Some((min, max))
        } else {
            None
        }
    }

    fn step(&mut self, dt: f32, left: bool, right: bool, fire: bool) {
        if self.game_over {
            return;
        }
        self.flap_time += dt;
        self.fire_cd -= dt;
        self.enemy_shot_cd -= dt;
        self.ufo_cd -= dt;

        // Player movement
        let mut dx = 0.0;
        if left {
            dx -= PL_SPEED;
        }
        if right {
            dx += PL_SPEED;
        }
        self.player_x = (self.player_x + dx * dt).clamp(0.0, ARENA_W - PL_W);

        // Player firing
        if fire && self.fire_cd <= 0.0 && self.bullets.len() < MAX_BULLETS {
            self.bullets.push(Bullet {
                x: self.player_x + PL_W / 2.0,
                y: ARENA_H - PL_H - 6.0,
                v: -420.0,
                from_player: true,
                w: BULLET_W,
                h: BULLET_H,
            });
            self.fire_cd = FIRE_CD;
        }

        // Invader grid movement
        let speed = self.speed * (1.0 + 0.06 * (self.wave - 1) as f32);
        if let Some((min, max)) = self.grid_bounds() {
            let next_min = min + self.dir * speed * dt;
            let next_max = max + self.dir * speed * dt;
            if (self.dir > 0.0 && next_max > ARENA_W - 6.0)
                || (self.dir < 0.0 && next_min < 6.0)
            {
                self.dir = -self.dir;
                self.speed *= 1.05;
                for inv in self.invaders.iter_mut() {
                    if inv.alive {
                        inv.y += DESCEND;
                    }
                }
            } else {
                for inv in self.invaders.iter_mut() {
                    if inv.alive {
                        inv.x += self.dir * speed * dt;
                    }
                }
            }
        }

        // Enemy firing
        if self.enemy_shot_cd <= 0.0 {
            if let Some((_, bx, by)) = self.bottom_most_alive() {
                self.bullets.push(Bullet {
                    x: bx,
                    y: by,
                    v: 240.0 + (self.wave as f32) * 8.0,
                    from_player: false,
                    w: BULLET_W,
                    h: BULLET_H,
                });
            }
            let spread = (0.7 + 0.35 * (self.rand() % 1000) as f32 / 1000.0)
                / (1.0 + 0.12 * (self.wave - 1) as f32);
            self.enemy_shot_cd = ENEMY_SHOT_BASE * spread;
        }

        // UFO spawn
        if self.ufo.is_none() && self.ufo_cd <= 0.0 {
            self.ufo = Some((-44.0, 1.0));
            self.ufo_cd = 8.0 + (self.rand() % 10) as f32;
        }

        // UFO movement
        self.ufo = self.ufo.map(|(x, d)| {
            let nx = x + d * 120.0 * dt;
            if nx < ARENA_W + 44.0 && nx > -44.0 {
                (nx, d)
            } else {
                (nx, d)
            }
        });

        // Bullets update + collision
        let mut i = 0;
        while i < self.bullets.len() {
            self.bullets[i].y += self.bullets[i].v * dt;

            let remove_basic = self.bullets[i].y < -20.0 || self.bullets[i].y > ARENA_H + 20.0;
            if remove_basic {
                self.bullets.swap_remove(i);
                continue;
            }

            let (bx, by, bfrom_player, bw, bh) = (
                self.bullets[i].x,
                self.bullets[i].y,
                self.bullets[i].from_player,
                self.bullets[i].w,
                self.bullets[i].h,
            );

            let mut remove = false;

            if bfrom_player {
                // Player bullet vs invaders
                for inv in self.invaders.iter_mut() {
                    if inv.alive
                        && aabb(bx, by, bw, bh, inv.x, inv.y, INV_W, INV_H)
                    {
                        inv.alive = false;
                        self.score += 10;
                        remove = true;
                        break;
                    }
                }
                // Player bullet vs UFO
                if !remove {
                    if let Some((ux, _d)) = self.ufo {
                        if aabb(bx, by, bw, bh, ux, 38.0, 56.0, 24.0) {
                            self.score += 60;
                            self.ufo = None;
                            remove = true;
                        }
                    }
                }
            } else {
                // Enemy bullet vs player
                if aabb(
                    bx, by, bw, bh,
                    self.player_x, ARENA_H - PL_H, PL_W, PL_H,
                ) {
                    self.lives -= 1;
                    remove = true;
                    if self.lives == 0 {
                        self.game_over = true;
                    }
                }
            }

            if remove {
                self.bullets.swap_remove(i);
            } else {
                i += 1;
            }
        }

        // Invaders reaching the bottom wall => game over
        for inv in &self.invaders {
            if inv.alive && inv.y + INV_H >= ARENA_H - PL_H - 10.0 {
                self.game_over = true;
            }
        }

        // Wave cleared => respawn faster
        let alive_count = self.invaders.iter().filter(|i| i.alive).count();
        if alive_count == 0 && !self.game_over {
            self.wave += 1;
            self.spawn_grid();
        }
    }

    fn build_snapshot(&self) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();

        // Header (7 × u32)
        out.extend_from_slice(&0x53495652u32.to_le_bytes()); // magic "SIVR"
        out.extend_from_slice(&0u32.to_le_bytes());          // entity count placeholder
        out.extend_from_slice(&self.score.to_le_bytes());
        out.extend_from_slice(&self.lives.to_le_bytes());
        out.extend_from_slice(&self.wave.to_le_bytes());
        out.extend_from_slice(&(self.game_over as u32).to_le_bytes());
        out.extend_from_slice(&(self.ufo.is_some() as u32).to_le_bytes());

        let mut entities: Vec<(f32, f32, f32, f32, f32, f32, f32)> = Vec::new();

        // Player
        if !self.game_over {
            entities.push((
                K_PLAYER,
                self.player_x,
                ARENA_H - PL_H,
                PL_W,
                PL_H,
                0.0,
                0.0,
            ));
        }

        // Invaders
        let flap = ((self.flap_time * 6.0) as i32 % 2) as f32;
        for inv in &self.invaders {
            if inv.alive {
                entities.push((K_INVADER, inv.x, inv.y, INV_W, INV_H, flap, 0.0));
            }
        }

        // UFO
        if let Some((ux, d)) = self.ufo {
            entities.push((
                K_UFO,
                ux,
                38.0,
                56.0,
                24.0,
                if d > 0.0 { 1.0 } else { -1.0 },
                0.0,
            ));
        }

        // Bullets
        for b in &self.bullets {
            let kind = if b.from_player { K_PBULLET } else { K_EBULLET };
            entities.push((kind, b.x, b.y, b.w, b.h, 0.0, 0.0));
        }

        let count = entities.len() as u32;
        out[4..8].copy_from_slice(&count.to_le_bytes());

        // Entities: kind,x,y,w,h,flap,reserved = 7 × f32 = 28 bytes each
        for (k, x, y, w, h, f, r) in &entities {
            for v in [*k, *x, *y, *w, *h, *f, *r] {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        out
    }
}

fn aabb(
    ax: f32, ay: f32, aw: f32, ah: f32,
    bx: f32, by: f32, bw: f32, bh: f32,
) -> bool {
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn get_state() -> Option<State> {
    STATE.with(|c| c.borrow_mut().take())
}

fn set_state(s: State) {
    STATE.with(|c| *c.borrow_mut() = Some(s));
}

#[wasm_bindgen]
pub fn init() {
    let mut s = State::new();
    s.spawn_grid();
    set_state(s);
}

#[wasm_bindgen]
pub fn reset() {
    let mut s = State::new();
    s.spawn_grid();
    set_state(s);
}

#[wasm_bindgen]
pub fn step(dt_ms: f32, left: bool, right: bool, fire: bool) -> Vec<u8> {
    let dt = dt_ms / 1000.0;
    let mut s = get_state().unwrap_or_else(State::new);
    s.step(dt, left, right, fire);
    let snap = s.build_snapshot();
    set_state(s);
    snap
}

#[wasm_bindgen]
pub fn score() -> u32 {
    let s = get_state().unwrap_or_else(State::new);
    let v = s.score;
    set_state(s);
    v
}

#[wasm_bindgen]
pub fn lives() -> u32 {
    let s = get_state().unwrap_or_else(State::new);
    let v = s.lives;
    set_state(s);
    v
}

#[wasm_bindgen]
pub fn wave() -> u32 {
    let s = get_state().unwrap_or_else(State::new);
    let v = s.wave;
    set_state(s);
    v
}

#[wasm_bindgen]
pub fn game_over() -> bool {
    let s = get_state().unwrap_or_else(State::new);
    let v = s.game_over;
    set_state(s);
    v
}