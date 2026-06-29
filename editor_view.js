/* editor_view.js — Screen 1: the robot's top deck, viewed top-down.
 *
 * The circuit board IS the top of the robot, so we draw ONE body rectangle and
 * lay everything out inside it exactly as the physical board is wired:
 *   - FRONT of robot = TOP of canvas: sensor headers (LDRs outboard angled out,
 *     IRs inboard forward).
 *   - REAR of robot = BOTTOM of canvas: motor headers (left / right).
 *   - MIDDLE: the two neurons (left / right), each between its sensors and motor.
 *   - Wires flow TOP -> BOTTOM: sensor -> neuron E/I -> (neuron drives its motor).
 *   - Large round front wheels poke out the sides, toward the front.
 *
 * Drag from a sensor header to a neuron's E (excite) or I (inhibit) input to
 * wire it. Drag a neuron's trimpot to set bias. Double-click a sensor to change
 * its type. Click a wire to remove it.
 */

const COL = {
  light: '#ffdd57', prox: '#ff6b6b', motor: '#58a6ff',
  excite: '#3fb950', inhibit: '#f85149',
  deck: '#12161d', deckLine: '#3a4250', chassis: '#1a1f27',
  ink: '#e6edf3', dim: '#8b949e', tyre: '#0c0e12', tyreLine: '#2b3038',
};
// LDR colour-channel swatch colours (W/R/G/B). W shown as the warm LDR yellow.
const LDR_CH_COL = { W: '#ffdd57', R: '#ff5a5a', G: '#50d25a', B: '#5a96ff' };

export class EditorView {
  constructor(canvas, vehicle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.v = vehicle;
    this.headers = [];
    this.dragFrom = null; this.dragXY = null; this.hoverHeader = null;
    this.trimDrag = null;
    this._bind();
    this.layout();
  }

  layout() {
    const W = this.canvas.width, H = this.canvas.height;
    this.W = W; this.H = H;
    this.headers = [];

    // The body rectangle = the robot deck. Center it, leave room for wheels.
    const margin = 90;                    // side room for wheels + labels
    this.deck = {
      x: margin, y: 40, w: W - margin * 2, h: H - 80,
    };
    const d = this.deck;
    // map body-frame metres -> deck pixels. Front(+y) = top, +x = right.
    // body is bodyL (front-back) tall, bodyW (left-right) wide.
    this.sx = d.w / (this.v.bodyW * 1.9);   // px per metre (x)
    this.sy = d.h / (this.v.bodyL * 1.9);   // px per metre (y)
    this.cx = d.x + d.w / 2;
    this.frontY = d.y + d.h * 0.12;          // y of the front edge (sensors)
    this.rearY  = d.y + d.h * 0.88;          // y of the rear edge (motors)
    this.midY   = (this.frontY + this.rearY) / 2;

    // ── Sensor headers at the FRONT (top), x by mount, fixed front y ──
    for (const mp of this.v.mountPoints) {
      const px = this.cx + mp.x * this.sx;
      this.headers.push({
        id: 'out_' + mp.id, kind: 'sensor-out', sensorId: mp.id, mountId: mp.id,
        x: px, y: this.frontY, r: 11, sensorType: this.v.loadout[mp.id],
        channel: this.v.channels[mp.id] || 'W',
      });
    }
    // ── Motor headers at the REAR (bottom) ──
    const mlx = this.cx - this.v.bodyW * 0.30 * this.sx;
    const mrx = this.cx + this.v.bodyW * 0.30 * this.sx;
    this.headers.push({ id: 'motor_L', kind: 'motor-in', motor: 'L', x: mlx, y: this.rearY, r: 12 });
    this.headers.push({ id: 'motor_R', kind: 'motor-in', motor: 'R', x: mrx, y: this.rearY, r: 12 });

    // ── Neurons in the MIDDLE (left / right), each over its motor ──
    this.v.neurons.forEach(n => {
      const nx = (n.motor === 'L') ? mlx : mrx;
      n._cx = nx; n._cy = this.midY; n._r = 30;
      // E and I inputs at the TOP of the neuron (facing the sensors above)
      n._E = { x: nx - 16, y: this.midY - 30 };
      n._I = { x: nx + 16, y: this.midY - 30 };
      this.headers.push({ id: n.id + '_E', kind: 'neuron-in', neuronId: n.id, sign: +1, x: n._E.x, y: n._E.y, r: 9 });
      this.headers.push({ id: n.id + '_I', kind: 'neuron-in', neuronId: n.id, sign: -1, x: n._I.x, y: n._I.y, r: 9 });
      // N output at the BOTTOM (facing the motor below)
      n._N = { x: nx, y: this.midY + 32 };
      this.headers.push({ id: n.id + '_N', kind: 'neuron-out', neuronId: n.id, x: n._N.x, y: n._N.y, r: 8 });
    });
  }

  // ── drawing ──
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawChassisAndWheels();
    this._drawDeck();
    this._drawNeurons();
    this._drawWires();
    if (this.dragFrom && this.dragXY) {
      ctx.strokeStyle = COL.excite; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(this.dragFrom.x, this.dragFrom.y); ctx.lineTo(this.dragXY.x, this.dragXY.y);
      ctx.stroke(); ctx.setLineDash([]);
    }
    this._drawHeaders();
    this._labels();
  }

  _drawChassisAndWheels() {
    const ctx = this.ctx, d = this.deck;
    // big round front wheels, toward the front, poking out each side
    const wheelW = 26, wheelH = 70;
    const wy = this.frontY + (this.rearY - this.frontY) * 0.10;   // toward front
    for (const side of [-1, 1]) {
      const wx = (side < 0) ? d.x - wheelW * 0.55 : d.x + d.w - wheelW * 0.45;
      ctx.fillStyle = COL.tyre; ctx.strokeStyle = COL.tyreLine; ctx.lineWidth = 2;
      this._roundRect(wx, wy - wheelH / 2, wheelW, wheelH, 12);
      ctx.fill(); ctx.stroke();
      // hub
      ctx.fillStyle = '#3a4250';
      ctx.beginPath(); ctx.arc(wx + wheelW / 2, wy, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawDeck() {
    const ctx = this.ctx, d = this.deck;
    // deck (the circuit board = the body outline)
    ctx.fillStyle = COL.deck; ctx.strokeStyle = COL.deckLine; ctx.lineWidth = 2.5;
    this._roundRect(d.x, d.y, d.w, d.h, 14); ctx.fill(); ctx.stroke();
    // faint front/rear guide lines
    ctx.strokeStyle = '#222a34'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(d.x + 10, this.frontY); ctx.lineTo(d.x + d.w - 10, this.frontY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.x + 10, this.rearY); ctx.lineTo(d.x + d.w - 10, this.rearY); ctx.stroke();
    ctx.setLineDash([]);
    // FRONT / REAR labels
    ctx.fillStyle = COL.dim; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('▲ FRONT', this.cx, d.y - 14);
    ctx.fillText('REAR ▼', this.cx, d.y + d.h + 22);
  }

  _drawNeurons() {
    const ctx = this.ctx;
    for (const n of this.v.neurons) {
      const { _cx: cx, _cy: cy, _r: r } = n;
      // triangle pointing DOWN (signal flows top->bottom, toward the motor)
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy - r); ctx.lineTo(cx, cy + r);
      ctx.closePath();
      ctx.fillStyle = '#1b2230'; ctx.strokeStyle = COL.deckLine; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
      // bias trimpot dial in the triangle
      const tx = cx, ty = cy - r * 0.25;
      ctx.beginPath(); ctx.arc(tx, ty, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117'; ctx.strokeStyle = COL.motor; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
      const ang = (-Math.PI / 2) + n.bias * (Math.PI * 0.8);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ang) * 9, ty + Math.sin(ang) * 9);
      ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke();
      // labels
      ctx.fillStyle = COL.dim; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('bias ' + n.bias.toFixed(2), cx + r + 30, cy);
    }
  }

  _wireLines() {
    const lines = [];
    for (const n of this.v.neurons) {
      for (const inp of n.inputs) {
        const src = this.headers.find(h => h.id === 'out_' + inp.sensorId);
        const dst = this.headers.find(h => h.id === n.id + (inp.sign > 0 ? '_E' : '_I'));
        if (src && dst) lines.push({ from: src, to: dst, sign: inp.sign, sensorId: inp.sensorId, neuronId: n.id });
      }
      const nout = this.headers.find(h => h.id === n.id + '_N');
      const motor = this.headers.find(h => h.kind === 'motor-in' && h.motor === n.motor);
      if (nout && motor) lines.push({ from: nout, to: motor, sign: 0 });
    }
    return lines;
  }

  _drawWires() {
    const ctx = this.ctx;
    for (const ln of this._wireLines()) {
      ctx.strokeStyle = ln.sign > 0 ? COL.excite : ln.sign < 0 ? COL.inhibit : COL.motor;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ln.from.x, ln.from.y);
      const my = (ln.from.y + ln.to.y) / 2;     // vertical bezier (top->bottom flow)
      ctx.bezierCurveTo(ln.from.x, my, ln.to.x, my, ln.to.x, ln.to.y);
      ctx.stroke();
    }
  }

  _drawHeaders() {
    const ctx = this.ctx;
    for (const h of this.headers) {
      let fill = COL.dim, ring = COL.deckLine;
      if (h.kind === 'sensor-out') {
        if (h.sensorType === 'LDR') fill = LDR_CH_COL[h.channel || 'W'];
        else if (h.sensorType === 'IR') fill = COL.prox;
        else fill = '#3a4250';
      }
      else if (h.kind === 'neuron-in') fill = h.sign > 0 ? COL.excite : COL.inhibit;
      else if (h.kind === 'neuron-out') fill = COL.ink;
      else if (h.kind === 'motor-in') fill = COL.motor;
      if (h === this.hoverHeader) ring = COL.ink;
      // sensor headers drawn as little rectangles (IR) or circles (LDR) for legibility
      if (h.kind === 'sensor-out' && h.sensorType === 'IR') {
        ctx.fillStyle = fill; ctx.strokeStyle = ring; ctx.lineWidth = 2;
        this._roundRect(h.x - 8, h.y - 9, 16, 18, 3); ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke();
      }
      // labels
      ctx.fillStyle = COL.dim; ctx.font = '10px monospace';
      if (h.kind === 'neuron-in') { ctx.textAlign = 'center'; ctx.fillText(h.sign > 0 ? 'E' : 'I', h.x, h.y - 13); }
      if (h.kind === 'sensor-out') {
        ctx.textAlign = 'center';
        const label = (h.sensorType === 'LDR') ? `LDR·${h.channel || 'W'}`
                    : (h.sensorType === 'IR') ? 'IR' : '—';
        ctx.fillText(label, h.x, h.y - 15);
      }
      if (h.kind === 'motor-in') { ctx.textAlign = 'center'; ctx.fillText(h.motor === 'L' ? 'L motor' : 'R motor', h.x, h.y + 26); }
    }
  }

  _labels() {
    // (Instructions live in the side panel, not on the canvas, to avoid
    // overlapping the REAR label and getting clipped.)
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ── interaction ──
  _bind() {
    const c = this.canvas;
    const xy = e => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
    };
    c.addEventListener('mousedown', e => {
      const p = xy(e);
      for (const n of this.v.neurons) {
        const tx = n._cx, ty = n._cy - n._r * 0.25;
        if (Math.hypot(p.x - tx, p.y - ty) < 13) { this.trimDrag = n.id; this._ty0 = p.y; this._b0 = n.bias; return; }
      }
      const h = this._hit(p);
      if (h && (h.kind === 'sensor-out' || h.kind === 'neuron-out')) { this.dragFrom = h; this.dragXY = p; return; }
      const w = this._hitWire(p);
      if (w && w.sign !== 0) { this.v.disconnect(w.sensorId, w.neuronId); this.draw(); if (this.onChange) this.onChange(); }
    });
    c.addEventListener('mousemove', e => {
      const p = xy(e);
      if (this.trimDrag) { this.v.setBias(this.trimDrag, this._b0 + (this._ty0 - p.y) / 80); this.draw(); return; }
      if (this.dragFrom) { this.dragXY = p; this.hoverHeader = this._hit(p); this.draw(); return; }
      const h = this._hit(p);
      if (h !== this.hoverHeader) { this.hoverHeader = h; this.draw(); }
    });
    c.addEventListener('mouseup', e => {
      const p = xy(e);
      if (this.trimDrag) { this.trimDrag = null; if (this.onChange) this.onChange(); return; }
      if (this.dragFrom) {
        const dst = this._hit(p);
        if (dst) this._tryConnect(this.dragFrom, dst);
        this.dragFrom = null; this.dragXY = null; this.hoverHeader = null;
        this.draw(); if (this.onChange) this.onChange();
      }
    });
    c.addEventListener('dblclick', e => {
      const p = xy(e);
      const h = this._hit(p);
      if (h && h.kind === 'sensor-out') {
        const cur = this.v.loadout[h.mountId];
        const next = cur === 'LDR' ? 'IR' : cur === 'IR' ? 'none' : 'LDR';
        this.v.setMount(h.mountId, next);
        this.layout(); this.draw(); if (this.onChange) this.onChange();
      }
    });
    // right-click an LDR to cycle its colour channel W -> R -> G -> B
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const p = xy(e);
      const h = this._hit(p);
      if (h && h.kind === 'sensor-out' && this.v.loadout[h.mountId] === 'LDR') {
        const order = ['W', 'R', 'G', 'B'];
        const cur = this.v.channels[h.mountId] || 'W';
        const next = order[(order.indexOf(cur) + 1) % order.length];
        this.v.setChannel(h.mountId, next);
        this.layout(); this.draw(); if (this.onChange) this.onChange();
      }
    });
  }

  _hit(p) {
    for (const h of this.headers) if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + 4) return h;
    return null;
  }
  _hitWire(p) {
    for (const ln of this._wireLines()) {
      if (ln.sign === 0) continue;
      if (this._near(p, ln.from, ln.to)) return ln;
    }
    return null;
  }
  _near(p, a, b) {
    const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey;
    let t = len2 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey)) < 9;
  }
  _tryConnect(from, to) {
    if (from.kind === 'sensor-out' && to.kind === 'neuron-in')
      this.v.connect(from.sensorId, to.neuronId, to.sign);
  }
}
