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

    // ── ONE AnaBBot-inspired body (v1: single fixed body plan) ──
    // Sensors: two LDRs splayed OUTWARD, two forward IR proximity sensors.
    // Convention (matches Python): angle is degrees CCW from body +Y (forward),
    // and +X = right. So a RIGHT-side sensor pointing outward-right needs a
    // NEGATIVE angle; a LEFT-side sensor pointing outward-left needs POSITIVE.
    this.sensors = [
      { id: 'L_light', type: 'LDR', mount: { x: -0.030, y: 0.035, angle:  30 } },
      { id: 'R_light', type: 'LDR', mount: { x:  0.030, y: 0.035, angle: -30 } },
      { id: 'L_prox',  type: 'IR',  mount: { x: -0.025, y: 0.040, angle:  15 } },
      { id: 'R_prox',  type: 'IR',  mount: { x:  0.025, y: 0.040, angle: -15 } },
    ];

    // ── Neurons (v1 model). Start with 2 (one per motor) but support more. ──
    // Each neuron: { id, bias, inputs: [{sensorId, sign}], motor: 'L'|'R'|null }
    this.neurons = [
      { id: 'n_L', bias: 0, inputs: [], motor: 'L' },
      { id: 'n_R', bias: 0, inputs: [], motor: 'R' },
    ];

    // Live readings cache (for HUD / inspection)
    this._readings = {};
    this._motorCmd = { L: 0, R: 0 };
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
