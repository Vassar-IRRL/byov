/* vehicle.js — the vehicle: body, sensors, neurons, motors, and wiring.
 *
 * Implements the v1 wiring model from the spec:
 *   - sensors (directional) -> neurons -> motors
 *   - a wire's SIGN comes from the input header it lands on: E=+1, I=-1
 *   - NO per-wire gain in v1 (magnitude always 1)
 *   - neuron: N = clamp(bias + Σ(signed sensor inputs), 0, 1)   [N output only]
 *   - bias per neuron in [-1, +1]
 */
import { sensorPose, readLDR, readIR, clamp } from './sim.js';

export class Vehicle {
  constructor() {
    // Robot pose (world metres / radians). Set by the arena on spawn.
    this.x = 0; this.y = 0; this.heading = Math.PI / 2; // start facing +Y (up)

    // ── ONE AnaBBot-inspired RECTANGULAR body (v1: single fixed body plan) ──
    // Front-wheel drive (motors on the sides), rear caster (not modelled).
    // Body dimensions roughly match the physical AnaBBot footprint.
    this.bodyW = 0.090;   // m — width (left-right)
    this.bodyL = 0.110;   // m — length (front-back)

    // Fixed sensor MOUNT POINTS at the front. The player chooses what sensor
    // (LDR / IR / none) occupies each mount. Placement is static for v1.
    // mount.x = body-frame right(+)/left(-), mount.y = forward(+); angle° CCW.
    this.mountPoints = [
      { id: 'm_FL', x: -0.030, y: 0.050, angle:  30 },  // front-left, splayed left
      { id: 'm_FC', x:  0.000, y: 0.055, angle:   0 },  // front-centre, forward
      { id: 'm_FR', x:  0.030, y: 0.050, angle: -30 },  // front-right, splayed right
    ];
    // Which sensor type sits at each mount (default loadout: two LDRs + one IR).
    this.loadout = { m_FL: 'LDR', m_FC: 'IR', m_FR: 'LDR' };

    this._rebuildSensors();

    // ── Neurons (v1 model). Two, one per motor. ──
    // Each: { id, bias, inputs:[{sensorId, sign}], motor:'L'|'R' }
    this.neurons = [
      { id: 'n_L', bias: 0, inputs: [], motor: 'L' },
      { id: 'n_R', bias: 0, inputs: [], motor: 'R' },
    ];

    this._readings = {};
    this._motorCmd = { L: 0, R: 0 };
  }

  /* Rebuild the active sensor list from the loadout (mount -> type). */
  _rebuildSensors() {
    this.sensors = [];
    for (const mp of this.mountPoints) {
      const type = this.loadout[mp.id];
      if (type === 'LDR' || type === 'IR') {
        this.sensors.push({
          id: mp.id, type,
          mount: { x: mp.x, y: mp.y, angle: mp.angle },
        });
      }
    }
  }

  /* Set a mount's sensor type ('LDR' | 'IR' | 'none'); rebuilds sensors and
   * drops any wires from a sensor that no longer exists. */
  setMount(mountId, type) {
    this.loadout[mountId] = type;
    this._rebuildSensors();
    const live = new Set(this.sensors.map(s => s.id));
    for (const n of this.neurons)
      n.inputs = n.inputs.filter(i => live.has(i.sensorId));
  }

  /* Read every sensor against the current world. Returns {sensorId: value}. */
  readSensors(lights, walls) {
    const out = {};
    for (const s of this.sensors) {
      const pose = sensorPose(this, s.mount);
      out[s.id] = (s.type === 'LDR') ? readLDR(pose, lights, walls)
                                     : readIR(pose, walls);
    }
    this._readings = out;
    return out;
  }

  /* Evaluate the wiring: sensors -> neurons -> motor commands.
   * v1 neuron: N = clamp(bias + Σ sign*signal, 0, 1).
   * Returns { L, R } motor commands in [0, 1] (N output is non-negative).
   */
  evaluate(readings) {
    const motor = { L: 0, R: 0 };
    for (const n of this.neurons) {
      let sum = n.bias;
      for (const inp of n.inputs) {
        const sig = readings[inp.sensorId] || 0;   // 0..1 physical reading
        sum += inp.sign * sig;                       // sign = +1 (E) or -1 (I)
      }
      const N = clamp(sum, 0, 1);
      if (n.motor === 'L' || n.motor === 'R') motor[n.motor] += N;
    }
    motor.L = clamp(motor.L, 0, 1);
    motor.R = clamp(motor.R, 0, 1);
    this._motorCmd = motor;
    return motor;
  }

  /* Wiring editing API (used by the UI). */
  connect(sensorId, neuronId, sign) {
    const n = this.neurons.find(n => n.id === neuronId);
    if (!n) return;
    // replace any existing wire from this sensor to this neuron
    n.inputs = n.inputs.filter(i => i.sensorId !== sensorId);
    n.inputs.push({ sensorId, sign });   // sign: +1 (E) or -1 (I)
  }
  disconnect(sensorId, neuronId) {
    const n = this.neurons.find(n => n.id === neuronId);
    if (n) n.inputs = n.inputs.filter(i => i.sensorId !== sensorId);
  }
  setBias(neuronId, bias) {
    const n = this.neurons.find(n => n.id === neuronId);
    if (n) n.bias = clamp(bias, -1, 1);
  }

  /* Serialise the vehicle's wiring (for save / record / lab write-up). */
  toJSON() {
    return {
      sensors: this.sensors.map(s => ({ ...s })),
      neurons: this.neurons.map(n => ({
        id: n.id, bias: n.bias, motor: n.motor,
        inputs: n.inputs.map(i => ({ ...i })),
      })),
    };
  }
  loadJSON(data) {
    if (data.neurons) {
      for (const nd of data.neurons) {
        const n = this.neurons.find(n => n.id === nd.id);
        if (n) { n.bias = nd.bias; n.inputs = nd.inputs.map(i => ({ ...i })); }
      }
    }
  }
}
