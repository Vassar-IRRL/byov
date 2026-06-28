/* editor_view.js — Screen 1: the combined robot + wiring editor.
 *
 * Draws the rectangular AnaBBot top-down (motors on the sides, sensors at the
 * front), with the neuron/wiring layer overlaid: sensor output headers ->
 * neuron E/I input headers -> neuron body (bias trimpot) -> neuron N output ->
 * motor input headers. Wiring is header-to-header (drag a wire from a source
 * header to a destination header), matching the desktop BYOV builder.
 *
 * v1 simplifications: no Meter headers, no Threshold (T) outputs, no wire
 * colour gains. N outputs only; wire sign by E vs I destination.
 */

const COL = {
  light: '#ffdd57', prox: '#ff6b6b', motor: '#58a6ff',
  excite: '#3fb950', inhibit: '#f85149',
  body: '#161b22', bodyLine: '#8b949e', ink: '#e6edf3', dim: '#8b949e',
  board: '#11151c', line: '#232a33', wire: '#9aa4b2',
};

export class EditorView {
  constructor(canvas, vehicle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.v = vehicle;
    this.headers = [];          // {id, kind, x, y, r, sensorId?, neuronId?, sign?, motor?}
    this.dragFrom = null;       // header being dragged from
    this.dragXY = null;         // current pointer position
    this.hoverHeader = null;
    this.trimDrag = null;       // neuron id whose trimpot is being dragged
    this._bind();
    this.layout();
  }

  layout() {
    const W = this.canvas.width, H = this.canvas.height;
    this.W = W; this.H = H;
    this.headers = [];

    // ── Robot drawn on the LEFT third (top-down, front pointing UP) ──
    this.robotCx = W * 0.24;
    this.robotCy = H * 0.52;
    this.robotScale = Math.min(W * 0.30, H * 0.62) / 0.12;   // px per metre

    // sensor mount headers (output side of each sensor) — at the front of body
    for (const mp of this.v.mountPoints) {
      const p = this._bodyToPx(mp.x, mp.y);
      const type = this.v.loadout[mp.id];
      this.headers.push({
        id: 'out_' + mp.id, kind: 'sensor-out', sensorId: mp.id,
        x: p.x, y: p.y, r: 9, sensorType: type, mountId: mp.id,
      });
    }
    // motor input headers — on the sides of the body
    const ml = this._bodyToPx(-this.v.bodyW / 2 - 0.012, 0.0);
    const mr = this._bodyToPx(this.v.bodyW / 2 + 0.012, 0.0);
    this.headers.push({ id: 'motor_L', kind: 'motor-in', motor: 'L', x: ml.x, y: ml.y, r: 10 });
    this.headers.push({ id: 'motor_R', kind: 'motor-in', motor: 'R', x: mr.x, y: mr.y, r: 10 });

    // ── Neurons on the RIGHT side: two triangles with E/I inputs + N output ──
    const nx = W * 0.66;
    const span = H * 0.6, top = H * 0.2;
    this.v.neurons.forEach((n, i) => {
      const cy = top + span * (i + 0.5) / this.v.neurons.length;
      n._cx = nx; n._cy = cy; n._r = 34;
      // E input header (top-left of triangle), I input header (bottom-left)
      this.headers.push({ id: n.id + '_E', kind: 'neuron-in', neuronId: n.id, sign: +1,
                          x: nx - 48, y: cy - 16, r: 9 });
      this.headers.push({ id: n.id + '_I', kind: 'neuron-in', neuronId: n.id, sign: -1,
                          x: nx - 48, y: cy + 16, r: 9 });
      // N output header (right point of triangle)
      this.headers.push({ id: n.id + '_N', kind: 'neuron-out', neuronId: n.id,
                          x: nx + 48, y: cy, r: 9 });
    });
  }

  _bodyToPx(bx, by) {
    // body frame: +x right, +y forward(up on screen). front points up => y up = -screen
    return { x: this.robotCx + bx * this.robotScale,
             y: this.robotCy - by * this.robotScale };
  }

  // ── drawing ──
  draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    this._drawRobot();
    this._drawNeurons();
    this._drawWires();
    if (this.dragFrom && this.dragXY) {
      ctx.strokeStyle = COL.excite; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(this.dragFrom.x, this.dragFrom.y);
      ctx.lineTo(this.dragXY.x, this.dragXY.y); ctx.stroke(); ctx.setLineDash([]);
    }
    this._drawHeaders();
    this._legend();
  }

  _drawRobot() {
    const ctx = this.ctx, v = this.v;
    const halfW = v.bodyW / 2 * this.robotScale, halfL = v.bodyL / 2 * this.robotScale;
    // body rectangle
    ctx.fillStyle = COL.body; ctx.strokeStyle = COL.bodyLine; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(this.robotCx - halfW, this.robotCy - halfL, halfW * 2, halfL * 2);
    ctx.fill(); ctx.stroke();
    // "front" label arrow (forward = up)
    ctx.fillStyle = COL.dim; ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('front', this.robotCx, this.robotCy - halfL - 8);
    // motors drawn on the sides (front-wheel drive)
    ctx.fillStyle = COL.motor;
    const mw = 8, mh = 22;
    ctx.fillRect(this.robotCx - halfW - mw, this.robotCy - halfL * 0.4, mw, mh);
    ctx.fillRect(this.robotCx + halfW,      this.robotCy - halfL * 0.4, mw, mh);
  }

  _drawNeurons() {
    const ctx = this.ctx;
    for (const n of this.v.neurons) {
      const { _cx: cx, _cy: cy, _r: r } = n;
      // triangle pointing right (signal flows left->right)
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.lineTo(cx + r, cy);
      ctx.closePath();
      ctx.fillStyle = '#1b2230'; ctx.strokeStyle = COL.bodyLine; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
      // bias trimpot: a dial whose pointer angle encodes bias (-1..+1)
      const tx = cx - r * 0.25, ty = cy;
      ctx.beginPath(); ctx.arc(tx, ty, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117'; ctx.strokeStyle = COL.motor; ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      const ang = (-Math.PI / 2) + n.bias * (Math.PI * 0.8); // up = 0
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(ang) * 9, ty + Math.sin(ang) * 9);
      ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke();
      // label
      ctx.fillStyle = COL.dim; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('bias ' + n.bias.toFixed(2), cx, cy + r + 14);
      ctx.fillText(n.motor === 'L' ? 'left motor' : 'right motor', cx, cy - r - 8);
    }
  }

  _wireEndpoints() {
    // returns list of {from:{x,y}, to:{x,y}, sign} for every wire + motor link
    const lines = [];
    for (const n of this.v.neurons) {
      // sensor -> neuron E/I
      for (const inp of n.inputs) {
        const src = this.headers.find(h => h.id === 'out_' + inp.sensorId);
        const dst = this.headers.find(h => h.id === n.id + (inp.sign > 0 ? '_E' : '_I'));
        if (src && dst) lines.push({ from: src, to: dst, sign: inp.sign });
      }
      // neuron N -> motor (implicit: each neuron drives its motor)
      const nout = this.headers.find(h => h.id === n.id + '_N');
      const motor = this.headers.find(h => h.kind === 'motor-in' && h.motor === n.motor);
      if (nout && motor) lines.push({ from: nout, to: motor, sign: 0 });
    }
    return lines;
  }

  _drawWires() {
    const ctx = this.ctx;
    for (const ln of this._wireEndpoints()) {
      ctx.strokeStyle = ln.sign > 0 ? COL.excite : ln.sign < 0 ? COL.inhibit : COL.motor;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ln.from.x, ln.from.y);
      // gentle curve
      const mx = (ln.from.x + ln.to.x) / 2;
      ctx.bezierCurveTo(mx, ln.from.y, mx, ln.to.y, ln.to.x, ln.to.y);
      ctx.stroke();
    }
  }

  _drawHeaders() {
    const ctx = this.ctx;
    for (const h of this.headers) {
      let fill = COL.dim, ring = COL.line;
      if (h.kind === 'sensor-out') fill = h.sensorType === 'LDR' ? COL.light : h.sensorType === 'IR' ? COL.prox : '#444';
      else if (h.kind === 'neuron-in') fill = h.sign > 0 ? COL.excite : COL.inhibit;
      else if (h.kind === 'neuron-out') fill = COL.ink;
      else if (h.kind === 'motor-in') fill = COL.motor;
      if (h === this.hoverHeader) ring = COL.ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke();
      // header label
      ctx.fillStyle = COL.dim; ctx.font = '10px monospace';
      if (h.kind === 'neuron-in') { ctx.textAlign = 'right'; ctx.fillText(h.sign > 0 ? 'E' : 'I', h.x - 13, h.y + 3); }
      if (h.kind === 'sensor-out') { ctx.textAlign = 'center'; ctx.fillText(h.sensorType || '—', h.x, h.y - 14); }
    }
  }

  _legend() {
    const ctx = this.ctx;
    ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = COL.dim;
    const x = 16, y = this.H - 56;
    ctx.fillText('Drag from a sensor (front of robot) to a neuron E or I input.', x, y);
    ctx.fillText('E = excite (green), I = inhibit (red).  Click a wire to remove it.', x, y + 16);
    ctx.fillText('Drag a neuron trimpot up/down to set its bias.  Click a sensor to change its type.', x, y + 32);
  }

  // ── interaction ──
  _bind() {
    const c = this.canvas;
    const xy = e => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (c.width / r.width),
               y: (e.clientY - r.top) * (c.height / r.height) };
    };
    c.addEventListener('mousedown', e => {
      const p = xy(e);
      // trimpot?
      for (const n of this.v.neurons) {
        const tx = n._cx - n._r * 0.25, ty = n._cy;
        if (Math.hypot(p.x - tx, p.y - ty) < 13) { this.trimDrag = n.id; this._trimStartY = p.y; this._trimStartBias = n.bias; return; }
      }
      // header drag start (from a source-capable header)
      const h = this._hit(p);
      if (h && (h.kind === 'sensor-out' || h.kind === 'neuron-out')) {
        this.dragFrom = h; this.dragXY = p; return;
      }
      // sensor type cycling: click a sensor-out header body
      if (h && h.kind === 'sensor-out') { /* handled in click */ }
      // wire removal: click near a wire
      const w = this._hitWire(p);
      if (w && w.sign !== 0) { this.v.disconnect(w._sensorId, w._neuronId); this.draw(); }
    });
    c.addEventListener('mousemove', e => {
      const p = xy(e);
      if (this.trimDrag) {
        const dy = (this._trimStartY - p.y) / 80;
        this.v.setBias(this.trimDrag, this._trimStartBias + dy);
        this.draw(); return;
      }
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
    // click a sensor header to cycle its type (LDR -> IR -> none)
    c.addEventListener('click', e => {
      const p = xy(e);
      if (this._movedDuringDrag) { this._movedDuringDrag = false; return; }
    });
    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect();
      const p = { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
      const h = this._hit(p);
      if (h && h.kind === 'sensor-out') {
        const cur = this.v.loadout[h.mountId];
        const next = cur === 'LDR' ? 'IR' : cur === 'IR' ? 'none' : 'LDR';
        this.v.setMount(h.mountId, next);
        this.layout(); this.draw(); if (this.onChange) this.onChange();
      }
    });
  }

  _hit(p) {
    for (const h of this.headers)
      if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + 4) return h;
    return null;
  }
  _hitWire(p) {
    for (const n of this.v.neurons) {
      for (const inp of n.inputs) {
        const src = this.headers.find(h => h.id === 'out_' + inp.sensorId);
        const dst = this.headers.find(h => h.id === n.id + (inp.sign > 0 ? '_E' : '_I'));
        if (src && dst && this._near(p, src, dst)) return { sign: inp.sign, _sensorId: inp.sensorId, _neuronId: n.id };
      }
    }
    return null;
  }
  _near(p, a, b) {
    const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey;
    let t = len2 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * ex, cy = a.y + t * ey;
    return Math.hypot(p.x - cx, p.y - cy) < 8;
  }

  _tryConnect(from, to) {
    // valid: sensor-out -> neuron-in (creates a signed wire)
    if (from.kind === 'sensor-out' && to.kind === 'neuron-in') {
      this.v.connect(from.sensorId, to.neuronId, to.sign);
    }
    // neuron-out -> motor: implicit in v1 (each neuron already drives its motor),
    // so we ignore manual N->motor drags for now.
  }
}
