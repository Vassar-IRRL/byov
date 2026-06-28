/* arena.js — the world: boundary, internal walls, light sources, and all
 * canvas rendering (arena, vehicle body, directional sensor cones, trail).
 * Mirrors the physical PAW arena proportions (1.2 m × 1.6 m).
 */
import { PHYS, LDR, sensorPose } from './sim.js';

export class Arena {
  constructor(width = 1.2, height = 1.6) {
    this.W = width; this.H = height;
    this.walls = this._boundary();
    this.lights = [{ x: width * 0.5, y: height * 0.85, intensity: 1 }];
  }
  _boundary() {
    const { W, H } = this;
    return [
      { x1: 0, y1: 0, x2: W, y2: 0 },
      { x1: W, y1: 0, x2: W, y2: H },
      { x1: W, y1: H, x2: 0, y2: H },
      { x1: 0, y1: H, x2: 0, y2: 0 },
    ];
  }
  addWall(x1, y1, x2, y2) { this.walls.push({ x1, y1, x2, y2 }); }
  addLight(x, y, intensity = 1) { this.lights.push({ x, y, intensity }); }
  reset() { this.walls = this._boundary(); }
}

/* Renderer maps world metres -> canvas pixels and draws everything. */
export class Renderer {
  constructor(canvas, arena) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.arena = arena;
    this.trail = [];
    this._resize();
  }
  _resize() {
    // Fit arena into the canvas with margin, preserving aspect ratio.
    const c = this.canvas;
    const pad = 16;
    const availW = c.width - pad * 2, availH = c.height - pad * 2;
    this.scale = Math.min(availW / this.arena.W, availH / this.arena.H);
    this.ox = pad + (availW - this.arena.W * this.scale) / 2;
    this.oy = pad + (availH - this.arena.H * this.scale) / 2;
  }
  // world (m) -> canvas (px). World y is up; canvas y is down -> flip.
  tx(x) { return this.ox + x * this.scale; }
  ty(y) { return this.oy + (this.arena.H - y) * this.scale; }
  m(v) { return v * this.scale; }

  pushTrail(x, y) { this.trail.push({ x, y }); if (this.trail.length > 4000) this.trail.shift(); }
  clearTrail() { this.trail = []; }

  draw(vehicle, opts = {}) {
    const ctx = this.ctx, A = this.arena;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // arena floor
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(this.tx(0), this.ty(A.H), this.m(A.W), this.m(A.H));
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
    ctx.strokeRect(this.tx(0), this.ty(A.H), this.m(A.W), this.m(A.H));

    // light sources (glow)
    for (const L of A.lights) {
      const r = this.m(0.08) * (L.intensity || 1);
      const g = ctx.createRadialGradient(this.tx(L.x), this.ty(L.y), 0,
                                         this.tx(L.x), this.ty(L.y), r * 3);
      g.addColorStop(0, 'rgba(255,221,87,0.9)');
      g.addColorStop(0.4, 'rgba(255,221,87,0.25)');
      g.addColorStop(1, 'rgba(255,221,87,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.tx(L.x), this.ty(L.y), r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffdd57';
      ctx.beginPath(); ctx.arc(this.tx(L.x), this.ty(L.y), r * 0.5, 0, Math.PI * 2); ctx.fill();
    }

    // walls
    ctx.strokeStyle = '#8b949e'; ctx.lineWidth = Math.max(2, this.m(PHYS.WALL_T));
    for (const w of A.walls) {
      ctx.beginPath(); ctx.moveTo(this.tx(w.x1), this.ty(w.y1));
      ctx.lineTo(this.tx(w.x2), this.ty(w.y2)); ctx.stroke();
    }

    // trail
    if (this.trail.length > 1) {
      ctx.strokeStyle = 'rgba(88,166,255,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.tx(this.trail[0].x), this.ty(this.trail[0].y));
      for (const p of this.trail) ctx.lineTo(this.tx(p.x), this.ty(p.y));
      ctx.stroke();
    }

    if (vehicle) this._drawVehicle(vehicle, opts);
  }

  _drawVehicle(v, opts) {
    const ctx = this.ctx;
    const px = this.tx(v.x), py = this.ty(v.y);
    const R = this.m(PHYS.BODY_R);

    // sensor cones (the DIRECTIONALITY made visible — the anti-BugWorks feature)
    if (opts.showCones !== false) {
      for (const s of v.sensors) {
        const pose = sensorPose(v, s.mount);
        const half = (s.type === 'LDR') ? LDR.FOV_HALF : (Math.PI * 5 / 180);
        const len = this.m(s.type === 'LDR' ? 0.25 : 0.12);
        // canvas angle: world dir, but y flipped -> negate
        const a = -pose.dir;
        const cx = this.tx(pose.x), cy = this.ty(pose.y);
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, len, a - half, a + half);
        ctx.closePath();
        ctx.fillStyle = (s.type === 'LDR') ? 'rgba(255,221,87,0.10)'
                                           : 'rgba(255,107,107,0.10)';
        ctx.fill();
      }
    }

    // body
    ctx.fillStyle = '#1f6feb';
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // heading indicator (forward = +Y world)
    const hx = px + Math.cos(-v.heading) * R, hy = py + Math.sin(-v.heading) * R;
    ctx.strokeStyle = '#f0f6fc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();

    // sensor dots
    for (const s of v.sensors) {
      const pose = sensorPose(v, s.mount);
      ctx.fillStyle = (s.type === 'LDR') ? '#ffdd57' : '#ff6b6b';
      ctx.beginPath(); ctx.arc(this.tx(pose.x), this.ty(pose.y), 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // canvas px -> world m (for click placement of lights)
  toWorld(px, py) {
    return { x: (px - this.ox) / this.scale, y: this.arena.H - (py - this.oy) / this.scale };
  }
}
