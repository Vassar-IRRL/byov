/* app.js — wires the UI to the simulation: builds the wiring panel, runs the
 * main loop, handles light placement, presets, and record/export.
 */
import { Vehicle } from './vehicle.js';
import { Arena, Renderer } from './arena.js';
import { driveStep } from './sim.js';

const arena = new Arena();
const vehicle = new Vehicle();
spawnVehicle();

const canvas = document.getElementById('arena');
const renderer = new Renderer(canvas, arena);

let running = false;
let recording = false;
let recordData = null;
let showCones = true;
let raf = null;
let lastT = 0;

function spawnVehicle() {
  vehicle.x = arena.W * 0.5;
  vehicle.y = arena.H * 0.18;
  vehicle.heading = Math.PI / 2;       // face +Y (up, toward the light)
}

// ── Wiring UI ────────────────────────────────────────────────────────────────
function buildWiringUI() {
  const grid = document.getElementById('wiring-grid');
  grid.innerHTML = '';
  for (const n of vehicle.neurons) {
    const card = document.createElement('div');
    card.className = 'neuron-card';

    const motorName = n.motor === 'L' ? 'Left motor' : n.motor === 'R' ? 'Right motor' : n.id;
    card.innerHTML = `
      <div class="neuron-head">
        <span class="neuron-title"><span class="dot">●</span> ${motorName}</span>
        <span class="bias-row">
          bias
          <input type="range" min="-1" max="1" step="0.05" value="${n.bias}" data-bias="${n.id}">
          <span class="bias-val" id="biasval-${n.id}">${n.bias.toFixed(2)}</span>
        </span>
      </div>`;

    for (const s of vehicle.sensors) {
      const wire = n.inputs.find(i => i.sensorId === s.id);
      const state = wire ? (wire.sign > 0 ? 'E' : 'I') : 'off';
      const row = document.createElement('div');
      row.className = 'sensor-row';
      row.innerHTML = `
        <span class="sensor-name"><span class="swatch ${s.type}"></span>${s.id}</span>
        <div class="seg" data-sensor="${s.id}" data-neuron="${n.id}">
          <button data-v="E" class="${state==='E'?'on-E':''}">E</button>
          <button data-v="I" class="${state==='I'?'on-I':''}">I</button>
          <button data-v="off" class="${state==='off'?'on-off':''}">—</button>
        </div>`;
      card.appendChild(row);
    }
    grid.appendChild(card);
  }

  // bias sliders
  grid.querySelectorAll('input[data-bias]').forEach(sl => {
    sl.addEventListener('input', e => {
      const id = e.target.dataset.bias;
      const val = parseFloat(e.target.value);
      vehicle.setBias(id, val);
      document.getElementById(`biasval-${id}`).textContent = val.toFixed(2);
    });
  });
  // E/I/off segment buttons
  grid.querySelectorAll('.seg').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const sensorId = seg.dataset.sensor, neuronId = seg.dataset.neuron;
        const v = b.dataset.v;
        if (v === 'off') vehicle.disconnect(sensorId, neuronId);
        else vehicle.connect(sensorId, neuronId, v === 'E' ? +1 : -1);
        buildWiringUI();   // re-render to update button states
      });
    });
  });
}

// ── Presets (the classic Braitenberg vehicles — the teaching payload) ────────
const PRESETS = {
  'Vehicle 1 (alive)': v => {
    clearWiring(v);
    v.setBias('n_L', 0); v.setBias('n_R', 0);
    // one light sensor drives both motors -> moves faster in light
    v.connect('L_light', 'n_L', +1);
    v.connect('L_light', 'n_R', +1);
  },
  'Vehicle 2a (coward)': v => {
    clearWiring(v);
    v.setBias('n_L', 0.15); v.setBias('n_R', 0.15);
    v.connect('L_light', 'n_L', +1);   // uncrossed excitatory -> flees light
    v.connect('R_light', 'n_R', +1);
  },
  'Vehicle 2b (aggressor)': v => {
    clearWiring(v);
    v.setBias('n_L', 0.15); v.setBias('n_R', 0.15);
    v.connect('R_light', 'n_L', +1);   // crossed excitatory -> charges light
    v.connect('L_light', 'n_R', +1);
  },
  'Vehicle 3a (coward-love)': v => {
    clearWiring(v);
    v.setBias('n_L', 0.6); v.setBias('n_R', 0.6);
    v.connect('L_light', 'n_L', -1);   // uncrossed inhibitory -> stops facing light
    v.connect('R_light', 'n_R', -1);
  },
  'Vehicle 3b (explorer)': v => {
    clearWiring(v);
    v.setBias('n_L', 0.6); v.setBias('n_R', 0.6);
    v.connect('R_light', 'n_L', -1);   // crossed inhibitory -> lingers then leaves
    v.connect('L_light', 'n_R', -1);
  },
};
function clearWiring(v) {
  for (const n of v.neurons) { n.inputs = []; n.bias = 0; }
}
function buildPresets() {
  const box = document.getElementById('presets');
  box.innerHTML = '';
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      PRESETS[name](vehicle);
      buildWiringUI();
      doReset();
    });
    box.appendChild(b);
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
function step(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.05);
  lastT = t;
  const readings = vehicle.readSensors(arena.lights, arena.walls);
  const m = vehicle.evaluate(readings);
  driveStep(vehicle, m.L, m.R, dt, arena.walls);
  renderer.pushTrail(vehicle.x, vehicle.y);
  if (recording) recordData.frames.push({ x: +vehicle.x.toFixed(4), y: +vehicle.y.toFixed(4), h: +vehicle.heading.toFixed(4) });
  renderer.draw(vehicle, { showCones });
  raf = requestAnimationFrame(step);
}

function doRun() {
  running = !running;
  const btn = document.getElementById('btn-run');
  if (running) {
    btn.textContent = '⏸ Pause'; btn.classList.add('running');
    lastT = performance.now();
    raf = requestAnimationFrame(step);
  } else {
    btn.textContent = '▶ Run'; btn.classList.remove('running');
    if (raf) cancelAnimationFrame(raf);
  }
}
function doReset() {
  running = false;
  const btn = document.getElementById('btn-run');
  btn.textContent = '▶ Run'; btn.classList.remove('running');
  if (raf) cancelAnimationFrame(raf);
  spawnVehicle();
  renderer.clearTrail();
  renderer.draw(vehicle, { showCones });
}

// ── Record / export ──────────────────────────────────────────────────────────
function doRecord() {
  recording = !recording;
  const btn = document.getElementById('btn-record');
  const status = document.getElementById('rec-status');
  if (recording) {
    recordData = { meta: { arena: { W: arena.W, H: arena.H }, lights: arena.lights.map(l => ({ ...l })) },
                   vehicle: vehicle.toJSON(), frames: [] };
    btn.classList.add('running'); btn.textContent = '■ Stop';
    status.textContent = 'Recording…';
    document.getElementById('btn-export').disabled = true;
  } else {
    btn.classList.remove('running'); btn.textContent = '● Record';
    status.textContent = recordData ? `${recordData.frames.length} frames captured` : '';
    document.getElementById('btn-export').disabled = !recordData || recordData.frames.length === 0;
  }
}
function doExport() {
  if (!recordData) return;
  const blob = new Blob([JSON.stringify(recordData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'byov_run.json'; a.click();
  URL.revokeObjectURL(url);
}

// ── Light placement (click the arena) ────────────────────────────────────────
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  const w = renderer.toWorld(px, py);
  if (w.x >= 0 && w.x <= arena.W && w.y >= 0 && w.y <= arena.H) {
    arena.lights = [{ x: w.x, y: w.y, intensity: 1 }];
    renderer.draw(vehicle, { showCones });
  }
});

// ── Wire up controls ─────────────────────────────────────────────────────────
document.getElementById('btn-run').addEventListener('click', doRun);
document.getElementById('btn-reset').addEventListener('click', doReset);
document.getElementById('btn-record').addEventListener('click', doRecord);
document.getElementById('btn-export').addEventListener('click', doExport);
document.getElementById('chk-cones').addEventListener('change', e => {
  showCones = e.target.checked; renderer.draw(vehicle, { showCones });
});

// ── Init ─────────────────────────────────────────────────────────────────────
buildWiringUI();
buildPresets();
PRESETS['Vehicle 2b (aggressor)'](vehicle);  // start with a working light-seeker
buildWiringUI();
renderer.draw(vehicle, { showCones });
