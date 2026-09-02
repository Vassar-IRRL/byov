/* editor_view.js — Screen 1: the robot's top deck, viewed top-down.
 *
 * The circuit board IS the top of the robot, laid out like the physical
 * Ana BBot, front (top) to rear (bottom):
 *   - SENSOR headers along the front edge.
 *   - METERS M1 M2 M3 just behind them. Each takes exactly ONE wire and is
 *     DISPLAY ONLY — a meter never drives anything.
 *   - NEURONS in the middle, filling 3 rows of 2 (up to six), which is both the
 *     board's layout and a picture of network layers. None to begin with; the
 *     +/- buttons beside the robot add and remove them (removal is LIFO).
 *   - MOTORS at the rear, with ONE shared bias pot between them: a resting
 *     speed for both, so the vehicle can idle forward with no neurons at all.
 *
 * WIRES: colour is WEIGHT, not excite/inhibit —  blue 1x, green 2x, red 3x.
 * Excite vs inhibit comes from which input the wire lands on (E or I), exactly
 * as on the board. LEFT-CLICK a wire to cycle its colour/weight; RIGHT-CLICK a
 * wire to remove it. By default you wire a sensor STRAIGHT to a motor.
 *
 * SENSORS mount on a discrete ring around the hull. Drag a sensor MODULE to
 * slide it around the ring; drag its inboard PIN to run a wire. The wheel over
 * a module rotates its facing one step.
 */

import { MOTOR_SLOTS, MAX_NEURONS, MAX_SENSORS, RING_SLOTS } from './vehicle.js?v=10';

// 16-BIT palette, ported from engine/theme.py ("sixteenbit") in the
// PAW-Robotics suite. Mirrors the CSS variables in style.css — change both.
const COL = {
  prox: '#44ccff', motor: '#2878ff',
  excite: '#00ffa0', inhibit: '#ff2828',
  deck: '#000828', deckLine: '#4444cc',
  ink: '#ccdcff', dim: '#505a8c', tyre: '#000418', tyreLine: '#1c1c58',
  sunk: '#000418',         // PANEL_DEEP — modules, neurons, motors on the deck
  label: '#ffcc00',        // AMBER — deck captions and the add/remove pairs
};
const LDR_CH_COL = { W: '#ffdc3c', R: '#ff2828', G: '#00ffa0', B: '#2878ff' };
// Wire weight colours — blue 1x, green 2x, red 3x (engine/signals.py).
// Presentation only: the hex for each weight colour. The SET of colours is
// owned by WIRE_COLORS in vehicle.js — add one there and it needs a hex here.
const WIRE_COL = { blue: '#2878ff', green: '#00ffa0', red: '#ff2828' };
const SENSOR_OUTSET = 24;   // px the module sits proud of the hull outline

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

    const margin = 90;
    // The vertical inset has to clear a sensor module (SENSOR_OUTSET plus its
    // body and id label), because mounts now sit OUTSIDE the hull outline.
    const vpad = SENSOR_OUTSET + 38;   // module body + its id label
    this.deck = { x: margin, y: vpad, w: W - margin * 2, h: H - vpad * 2 };
    const d = this.deck;
    this.sx = d.w / (this.v.bodyW * 1.9);
    this.cx = d.x + d.w / 2;
    this.frontY  = d.y + d.h * 0.09;
    this.meterY  = d.y + d.h * 0.25;
    this.rowY    = [0.45, 0.59, 0.73].map(f => d.y + d.h * f);
    this.rearY   = d.y + d.h * 0.92;

    // ── Sensors: mounted on the RING around the hull ──
    // Body frame maps onto the deck rectangle: +X right, +Y forward (up).
    this.deckCx = d.x + d.w / 2;
    this.deckCy = d.y + d.h / 2;
    this.bpx = d.w / this.v.bodyW;      // canvas px per body metre, across
    this.bpy = d.h / this.v.bodyL;      // canvas px per body metre, along
    for (const mp of this.v.mountPoints) {
      const g = this._mountGeom(mp);
      const shared = { mountId: mp.id, sensorType: this.v.loadout[mp.id],
                       channel: this.v.channels[mp.id] || 'W' };
      // The module: drag it to slide around the ring.
      this.headers.push({ id: 'body_' + mp.id, kind: 'sensor-body',
                          x: g.x, y: g.y, r: 13, angle: mp.angle, slot: mp.slot,
                          nx: g.nx, ny: g.ny, ...shared });
      // The output pin, inboard: drag it to run a wire.
      this.headers.push({ id: 'out_' + mp.id, kind: 'sensor-out', srcId: mp.id,
                          x: g.pin.x, y: g.pin.y, r: 7, ...shared });
    }

    // ── Meters M1..M3, just behind the sensors. One input each. ──
    const mgap = Math.min(130, (d.w - 60) / 3);
    this.v.meters.forEach((mt, i) => {
      const mx = this.cx + (i - 1) * mgap;
      mt._cx = mx; mt._cy = this.meterY; mt._w = 54; mt._h = 26;
      mt._in = { x: mx, y: this.meterY - 22 };
      this.headers.push({ id: mt.id + '_in', kind: 'meter-in', targetId: mt.id, sign: +1,
                          x: mt._in.x, y: mt._in.y, r: 9 });
    });

    // ── Neurons: 3 rows of 2 ──
    const colX = [this.cx - 62, this.cx + 62];
    this.v.neurons.forEach((n, i) => {
      const nx = colX[i % 2], ny = this.rowY[Math.floor(i / 2)];
      n._cx = nx; n._cy = ny; n._r = 20;
      n._E = { x: nx - 14, y: ny - 20 };
      n._I = { x: nx + 14, y: ny - 20 };
      n._N = { x: nx, y: ny + 23 };
      this.headers.push({ id: n.id + '_E', kind: 'neuron-in', targetId: n.id, sign: +1, x: n._E.x, y: n._E.y, r: 8 });
      this.headers.push({ id: n.id + '_I', kind: 'neuron-in', targetId: n.id, sign: -1, x: n._I.x, y: n._I.y, r: 8 });
      this.headers.push({ id: n.id + '_N', kind: 'neuron-out', srcId: n.id, x: n._N.x, y: n._N.y, r: 8 });
    });

    // ── Motors at the REAR, with ONE shared bias pot between them ──
    const mlx = this.cx - this.v.bodyW * 0.32 * this.sx;
    const mrx = this.cx + this.v.bodyW * 0.32 * this.sx;
    // Each motor gets a FORWARD bank and a REVERSE bank of four grey headers,
    // like the board's FL/BL (and FR/BR) sockets. No excite/inhibit here — you
    // choose a direction, and a reverse wire subtracts from forward.
    const hgap = 14;
    for (const m of this.v.motors) {
      const mx = (m.id === 'L') ? mlx : mrx;
      m._cx = mx; m._cy = this.rearY; m._r = 13;
      m._bankY = { fwd: this.rearY - 54, rev: this.rearY - 30 };
      for (const dir of ['fwd', 'rev']) {
        for (let k = 0; k < MOTOR_SLOTS; k++) {
          const hx = mx + (k - (MOTOR_SLOTS - 1) / 2) * hgap;
          this.headers.push({ id: `${m.id}_${dir}${k}`, kind: 'motor-in',
                              targetId: m.id, dir, slot: k,
                              x: hx, y: m._bankY[dir], r: 6 });
        }
      }
    }
    this.biasPot = { x: this.cx, y: this.rearY, r: 13 };

    // ── +/- neuron buttons, OUTSIDE the robot, left of its outer edge ──
    // Buttons live OUTSIDE the chassis, in the canvas corners. The ring can put
    // a sensor anywhere on the deck perimeter, but a module is pushed out
    // radially from the deck centre, so one mounted near a deck corner travels
    // diagonally and leaves the canvas corner clear. Anywhere else in the
    // margin, a sensor eventually lands on top of the buttons.
    const bw = 28, bh = 26, bx = 8;
    this.addSensorBtn = { x: bx, y: 26,      w: bw, h: bh };
    this.subSensorBtn = { x: bx, y: 60,      w: bw, h: bh };
    this.addBtn       = { x: bx, y: H - 100, w: bw, h: bh };
    this.subBtn       = { x: bx, y: H - 66,  w: bw, h: bh };
  }

  /* Canvas geometry for a mount: the module sits proud of the hull at its slot,
   * with its output pin just inboard of the outline. */
  _mountGeom(mp) {
    const p = this.v.slotPos(mp.slot);
    const px = this.deckCx + p.x * this.bpx;
    const py = this.deckCy - p.y * this.bpy;
    let ox = px - this.deckCx, oy = py - this.deckCy;
    const len = Math.hypot(ox, oy) || 1;
    ox /= len; oy /= len;
    return { x: px + ox * SENSOR_OUTSET, y: py + oy * SENSOR_OUTSET,
             pin: { x: px - ox * 6, y: py - oy * 6 }, nx: ox, ny: oy };
  }

  /* Ring slot nearest a canvas point. */
  _slotFromPoint(p) {
    const bx =  (p.x - this.deckCx) / this.bpx;     // body +X (right)
    const by = -(p.y - this.deckCy) / this.bpy;     // body +Y (forward)
    const deg = Math.atan2(-bx, by) * 180 / Math.PI;   // CCW from forward
    const step = 360 / RING_SLOTS;
    return ((Math.round(deg / step) % RING_SLOTS) + RING_SLOTS) % RING_SLOTS;
  }

  /* Unit vector, in canvas space, of a body-frame facing in degrees CCW from
   * forward. Forward is up (-y) and CCW swings to port (-x). */
  _facingVec(deg) {
    const th = deg * Math.PI / 180;
    return { x: -Math.sin(th), y: -Math.cos(th) };
  }

  // ── drawing ──
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawChassisAndWheels();
    this._drawDeck();
    this._drawMeters();
    this._drawNeurons();
    this._drawMotors();
    this._drawWires();
    if (this.dragFrom && this.dragXY) {
      ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(this.dragFrom.x, this.dragFrom.y); ctx.lineTo(this.dragXY.x, this.dragXY.y);
      ctx.stroke(); ctx.setLineDash([]);
    }
    this._drawSensors();
    this._drawHeaders();
    this._drawButtons();
  }

  _drawChassisAndWheels() {
    const ctx = this.ctx, d = this.deck;
    const wheelW = 26, wheelH = 70;
    const wy = this.frontY + (this.rearY - this.frontY) * 0.10;
    for (const side of [-1, 1]) {
      const wx = (side < 0) ? d.x - wheelW * 0.55 : d.x + d.w - wheelW * 0.45;
      ctx.fillStyle = COL.tyre; ctx.strokeStyle = COL.tyreLine; ctx.lineWidth = 2;
      this._roundRect(wx, wy - wheelH / 2, wheelW, wheelH, 12);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1c1c58';
      ctx.beginPath(); ctx.arc(wx + wheelW / 2, wy, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawDeck() {
    const ctx = this.ctx, d = this.deck;
    ctx.fillStyle = COL.deck; ctx.strokeStyle = COL.deckLine; ctx.lineWidth = 2.5;
    this._roundRect(d.x, d.y, d.w, d.h, 14); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#1c1c58'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    for (const y of [this.frontY, this.rearY]) {
      ctx.beginPath(); ctx.moveTo(d.x + 10, y); ctx.lineTo(d.x + d.w - 10, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = COL.dim; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('▲ FRONT', this.cx, d.y + 16);
    ctx.textAlign = 'left';
    ctx.fillText('REAR ▼', d.x + 12, d.y + d.h - 10);
    ctx.textAlign = 'center';
  }

  _drawMeters() {
    const ctx = this.ctx;
    for (const mt of this.v.meters) {
      const val = (this.v._meterVals && this.v._meterVals[mt.id]) || 0;
      const x = mt._cx - mt._w / 2, y = mt._cy - mt._h / 2;
      ctx.fillStyle = COL.sunk; ctx.strokeStyle = COL.deckLine; ctx.lineWidth = 2;
      this._roundRect(x, y, mt._w, mt._h, 4); ctx.fill(); ctx.stroke();
      // fill bar showing the metered value
      if (val > 0) {
        ctx.fillStyle = '#00ffa0';
        this._roundRect(x + 3, y + mt._h - 9, (mt._w - 6) * val, 5, 2); ctx.fill();
      }
      ctx.fillStyle = COL.ink; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(mt.id + '  ' + val.toFixed(2), mt._cx, mt._cy - 1);
    }
  }

  _drawNeurons() {
    const ctx = this.ctx;
    for (const n of this.v.neurons) {
      const { _cx: cx, _cy: cy, _r: r } = n;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy - r); ctx.lineTo(cx, cy + r);
      ctx.closePath();
      ctx.fillStyle = COL.sunk; ctx.strokeStyle = COL.deckLine; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
      const tx = cx, ty = cy - r * 0.3;
      ctx.beginPath(); ctx.arc(tx, ty, 9, 0, Math.PI * 2);
      ctx.fillStyle = COL.sunk; ctx.strokeStyle = COL.motor; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
      const ang = (-Math.PI / 2) + n.bias * (Math.PI * 0.8);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ang) * 7, ty + Math.sin(ang) * 7);
      ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = COL.dim; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(n.id, cx - r - 10, cy - 4);
    }
  }

  _drawMotors() {
    const ctx = this.ctx;
    for (const m of this.v.motors) {
      ctx.beginPath(); ctx.arc(m._cx, m._cy, m._r, 0, Math.PI * 2);
      ctx.fillStyle = COL.sunk; ctx.strokeStyle = COL.motor; ctx.lineWidth = 2.5;
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = COL.dim; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(m.id === 'L' ? 'L motor' : 'R motor', m._cx, m._cy + 27);
      // bank labels
      ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillStyle = COL.excite; ctx.fillText('FWD', m._cx - 34, m._bankY.fwd + 3);
      ctx.fillStyle = COL.label; ctx.fillText('REV', m._cx - 34, m._bankY.rev + 3);
      ctx.textAlign = 'center';
    }
    // the ONE shared bias pot, between the motors
    const b = this.biasPot;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = COL.sunk; ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    const ang = (-Math.PI / 2) + this.v.bias * (Math.PI * 0.8);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(ang) * 10, b.y + Math.sin(ang) * 10);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('bias ' + this.v.bias.toFixed(2), b.x, b.y + 27);
  }

  /* Wires are owned by their TARGET (neuron, motor or meter). */
  _wireLines() {
    const lines = [];
    const srcHeader = id => this.headers.find(h =>
      (h.kind === 'sensor-out' || h.kind === 'neuron-out') && h.srcId === id);
    const push = (inp, targetId, kind, sign) => {
      const src = srcHeader(inp.srcId);
      const dst = this.headers.find(h => h.kind === kind && h.targetId === targetId
                                    && (sign === undefined || h.sign === sign));
      if (src && dst) lines.push({ from: src, to: dst, color: inp.color || 'blue',
                                   srcId: inp.srcId, targetId });
    };
    for (const n of this.v.neurons) for (const i of n.inputs) push(i, n.id, 'neuron-in', i.sign);
    for (const m of this.v.motors) {
      for (const dir of ['fwd', 'rev']) {
        m[dir].forEach((inp, k) => {
          const src = srcHeader(inp.srcId);
          const dst = this.headers.find(h => h.kind === 'motor-in' && h.targetId === m.id
                                          && h.dir === dir && h.slot === k);
          if (src && dst) lines.push({ from: src, to: dst, color: inp.color || 'blue',
                                       srcId: inp.srcId, targetId: m.id });
        });
      }
    }
    for (const mt of this.v.meters) if (mt.input) push(mt.input, mt.id, 'meter-in');
    return lines;
  }

  _drawWires() {
    const ctx = this.ctx;
    for (const ln of this._wireLines()) {
      ctx.strokeStyle = WIRE_COL[ln.color] || WIRE_COL.blue;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ln.from.x, ln.from.y);
      const my = (ln.from.y + ln.to.y) / 2;
      ctx.bezierCurveTo(ln.from.x, my, ln.to.x, my, ln.to.x, ln.to.y);
      ctx.stroke();
    }
  }

  /* A sensor module: a body sitting proud of the hull, a tick showing which way
   * it faces, and its id on the outboard side. The wiring pin is a header and
   * is drawn by _drawHeaders. */
  _drawSensors() {
    const ctx = this.ctx;
    for (const h of this.headers) {
      if (h.kind !== 'sensor-body') continue;
      const type = h.sensorType;
      const tint = type === 'LDR' ? LDR_CH_COL[h.channel || 'W']
                 : type === 'IR'  ? COL.prox : '#1c1c58';
      const active = (h === this.hoverHeader) || (this.moveDrag && this.moveDrag.id === h.mountId);

      // facing tick
      const v = this._facingVec(h.angle);
      ctx.strokeStyle = tint; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x + v.x * 21, h.y + v.y * 21); ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x + v.x * 21, h.y + v.y * 21, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = tint; ctx.fill();

      // module body
      ctx.fillStyle = COL.sunk;
      ctx.strokeStyle = active ? COL.ink : tint; ctx.lineWidth = 2.5;
      this._roundRect(h.x - 12, h.y - 10, 24, 20, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = tint; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(type === 'LDR' ? (h.channel || 'W') : type === 'IR' ? 'IR' : '—', h.x, h.y + 3);

      // id, outboard
      ctx.fillStyle = active ? COL.ink : COL.dim; ctx.font = '9px monospace';
      ctx.fillText(h.mountId, h.x + h.nx * 22, h.y + h.ny * 22 + 3);
    }
  }

  _drawHeaders() {
    const ctx = this.ctx;
    for (const h of this.headers) {
      let fill = COL.dim, ring = COL.deckLine;
      if (h.kind === 'sensor-body') continue;          // drawn by _drawSensors
      if (h.kind === 'sensor-out') {
        if (h.sensorType === 'LDR') fill = LDR_CH_COL[h.channel || 'W'];
        else if (h.sensorType === 'IR') fill = COL.prox;
        else fill = '#1c1c58';
      }
      else if (h.kind === 'neuron-in') fill = h.sign > 0 ? COL.excite : COL.inhibit;
      else if (h.kind === 'motor-in') fill = '#288cc8';
      else if (h.kind === 'neuron-out') fill = COL.ink;
      else if (h.kind === 'meter-in') fill = '#288cc8';
      if (h === this.hoverHeader) ring = COL.ink;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = COL.dim; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      if (h.kind === 'neuron-in') ctx.fillText(h.sign > 0 ? 'E' : 'I', h.x, h.y - 11);
    }
  }

  _drawButtons() {
    const ctx = this.ctx;
    const n = this.v.neurons.length;
    const btn = (b, label, enabled) => {
      ctx.fillStyle = enabled ? COL.sunk : COL.sunk;
      ctx.strokeStyle = enabled ? COL.label : COL.deckLine; ctx.lineWidth = 1.5;
      this._roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = enabled ? COL.label : '#1c1c58';
      ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 5);
    };
    btn(this.addBtn, '+', n < MAX_NEURONS);
    btn(this.subBtn, '−', n > 0);
    const sn = this.v.mountPoints.length;
    btn(this.addSensorBtn, '+', sn < MAX_SENSORS);
    btn(this.subSensorBtn, '−', sn > 0);
    // Left-aligned: the buttons sit hard against the canvas edge, so a centred
    // caption wider than the button runs off it.
    ctx.fillStyle = COL.label; ctx.textAlign = 'left';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('SENSORS', this.addSensorBtn.x, this.addSensorBtn.y - 9);
    ctx.fillText('NEURONS', this.addBtn.x, this.addBtn.y - 9);
    ctx.font = 'bold 12px monospace';
    ctx.fillText(sn + '/' + MAX_SENSORS, this.subSensorBtn.x,
                 this.subSensorBtn.y + this.subSensorBtn.h + 15);
    ctx.fillText(n + '/' + MAX_NEURONS, this.subBtn.x,
                 this.subBtn.y + this.subBtn.h + 15);
    ctx.textAlign = 'center';
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
    const inBox = (p, b) => b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

    c.addEventListener('mousedown', e => {
      const p = xy(e);
      if (inBox(p, this.addBtn)) { this.v.addNeuron(); this.layout(); this.draw(); this._changed(); return; }
      if (inBox(p, this.subBtn)) { this.v.removeLastNeuron(); this.layout(); this.draw(); this._changed(); return; }
      // sensors: add lands in the free slot nearest the front; remove is LIFO,
      // matching how neurons behave.
      if (inBox(p, this.addSensorBtn)) {
        this.v.addSensor('LDR'); this.layout(); this.draw(); this._changed(); return;
      }
      if (inBox(p, this.subSensorBtn)) {
        const last = this.v.mountPoints[this.v.mountPoints.length - 1];
        if (last) this.v.removeSensor(last.id);
        this.layout(); this.draw(); this._changed(); return;
      }
      // neuron bias trimpots
      for (const n of this.v.neurons) {
        if (Math.hypot(p.x - n._cx, p.y - (n._cy - n._r * 0.3)) < 11) {
          this.trimDrag = { kind: 'neuron', id: n.id }; this._ty0 = p.y; this._b0 = n.bias; return;
        }
      }
      // the one shared motor bias pot
      const b = this.biasPot;
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + 2) {
        this.trimDrag = { kind: 'bias' }; this._ty0 = p.y; this._b0 = this.v.bias; return;
      }
      const h = this._hit(p);
      if (h && h.kind === 'sensor-body') {
        this.moveDrag = { id: h.mountId, moved: false }; this.draw(); return;
      }
      if (h && (h.kind === 'sensor-out' || h.kind === 'neuron-out')) { this.dragFrom = h; this.dragXY = p; return; }
      // LEFT-CLICK a wire cycles its colour (weight): blue -> green -> red
      const w = this._hitWire(p);
      if (w) { this.v.cycleWireColor(w.srcId, w.targetId); this.draw(); this._changed(); }
    });

    c.addEventListener('mousemove', e => {
      const p = xy(e);
      if (this.trimDrag) {
        const val = this._b0 + (this._ty0 - p.y) / 80;
        if (this.trimDrag.kind === 'bias') this.v.setBias(val);
        else this.v.setNeuronBias(this.trimDrag.id, val);
        this.draw(); return;
      }
      if (this.moveDrag) {
        const slot = this._slotFromPoint(p);
        const mp = this.v.mountPoints.find(m => m.id === this.moveDrag.id);
        // setSensorSlot refuses an occupied slot, so a crowded ring just holds.
        if (mp && mp.slot !== slot && this.v.setSensorSlot(this.moveDrag.id, slot)) {
          this.moveDrag.moved = true; this.layout(); this.draw();
        }
        return;
      }
      if (this.dragFrom) { this.dragXY = p; this.hoverHeader = this._hit(p); this.draw(); return; }
      const h = this._hit(p);
      if (h !== this.hoverHeader) { this.hoverHeader = h; this.draw(); }
    });

    c.addEventListener('mouseup', e => {
      const p = xy(e);
      if (this.trimDrag) { this.trimDrag = null; this._changed(); return; }
      if (this.moveDrag) {
        const md = this.moveDrag; this.moveDrag = null;
        if (!md.moved && this.v.loadout[md.id] === 'LDR') this._cycleChannel(md.id);
        this.layout(); this.draw(); this._changed(); return;
      }
      if (this.dragFrom) {
        const dst = this._hit(p);
        if (dst && dst === this.dragFrom && dst.kind === 'sensor-out'
            && this.v.loadout[dst.mountId] === 'LDR') {
          this._cycleChannel(dst.mountId);
        } else if (dst) {
          this._tryConnect(this.dragFrom, dst);
        }
        this.dragFrom = null; this.dragXY = null; this.hoverHeader = null;
        this.draw(); this._changed();
      }
    });

    c.addEventListener('dblclick', e => {
      const p = xy(e);
      const h = this._hit(p);
      if (h && (h.kind === 'sensor-out' || h.kind === 'sensor-body')) {
        const cur = this.v.loadout[h.mountId];
        const next = cur === 'LDR' ? 'IR' : cur === 'IR' ? 'none' : 'LDR';
        this.v.setMount(h.mountId, next);
        this.layout(); this.draw(); this._changed();
      }
    });

    // RIGHT-CLICK: remove a wire, or cycle an LDR's colour channel.
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const p = xy(e);
      const w = this._hitWire(p);
      if (w) { this.v.disconnect(w.srcId, w.targetId); this.draw(); this._changed(); return; }
      const h = this._hit(p);
      if (h && (h.kind === 'sensor-out' || h.kind === 'sensor-body')
            && this.v.loadout[h.mountId] === 'LDR') {
        this._cycleChannel(h.mountId); this.draw(); this._changed();
      }
    });

    // WHEEL over a sensor rotates its facing one ANGLE_STEP.
    c.addEventListener('wheel', e => {
      const h = this._hit(xy(e));
      if (!h || (h.kind !== 'sensor-body' && h.kind !== 'sensor-out')) return;
      e.preventDefault();
      this.v.rotateSensor(h.mountId, e.deltaY < 0 ? 1 : -1);
      this.layout(); this.draw(); this._changed();
    }, { passive: false });
  }

  _changed() { if (this.onChange) this.onChange(); }

  _hit(p) {
    for (const h of this.headers) if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + 4) return h;
    return null;
  }
  _hitWire(p) {
    for (const ln of this._wireLines()) if (this._near(p, ln.from, ln.to)) return ln;
    return null;
  }
  _near(p, a, b) {
    const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey;
    let t = len2 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey)) < 9;
  }
  _cycleChannel(mountId) {
    const order = ['W', 'R', 'G', 'B'];
    const cur = this.v.channels[mountId] || 'W';
    this.v.setChannel(mountId, order[(order.indexOf(cur) + 1) % order.length]);
    this.layout();
  }

  /* A source (sensor or neuron output) may land on a neuron/motor E or I input,
   * or on a meter (which holds exactly one wire). New wires start blue (1x). */
  _tryConnect(from, to) {
    const srcId = from.srcId;
    if (!srcId) return;
    if (to.kind === 'motor-in')       this.v.connect(srcId, to.targetId, to.dir, 'blue');
    else if (to.kind === 'neuron-in' || to.kind === 'meter-in')
      this.v.connect(srcId, to.targetId, to.sign, 'blue');
  }
}
