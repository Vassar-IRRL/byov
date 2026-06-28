/* app.js — two-screen BYOV: Build (robot+wiring) and Arena&run.
 */
import { Vehicle } from './vehicle.js';
import { Arena, Renderer } from './arena.js';
import { EditorView } from './editor_view.js';
import { driveStep } from './sim.js';

const arena = new Arena();
const vehicle = new Vehicle();
spawnVehicle();

// ── Screen 1: robot/wiring editor ──
const editorCanvas = document.getElementById('editor');
const editor = new EditorView(editorCanvas, vehicle);

// ── Screen 2: arena ──
const arenaCanvas = document.getElementById('arena');
const renderer = new Renderer(arenaCanvas, arena);

let running = false, recording = false, recordData = null, showCones = true;
let raf = null, lastT = 0, tool = 'light', editMode = true;

function spawnVehicle() {
  vehicle.x = arena.robotStart.x;
  vehicle.y = arena.robotStart.y;
  vehicle.heading = arena.robotStart.heading;
}

// ── Mode toggle ──
const tabBuild = document.getElementById('tab-build');
const tabRun = document.getElementById('tab-run');
function showBuild() {
  editMode = true; stopRun();
  document.getElementById('screen-build').classList.remove('hidden');
  document.getElementById('screen-run').classList.add('hidden');
  tabBuild.classList.add('active'); tabRun.classList.remove('active');
  editor.layout(); editor.draw();
}
function showRun() {
  editMode = false;
  document.getElementById('screen-build').classList.add('hidden');
  document.getElementById('screen-run').classList.remove('hidden');
  tabRun.classList.add('active'); tabBuild.classList.remove('active');
  renderer._resize(); drawArena();
}
tabBuild.addEventListener('click', showBuild);
tabRun.addEventListener('click', showRun);

// ── Presets ──
const PRESETS = {
  'Vehicle 1 (alive)': v => { clearWiring(v); v.connect('m_FL', 'n_L', +1); v.connect('m_FL', 'n_R', +1); },
  'Vehicle 2a (coward)': v => { clearWiring(v); v.setBias('n_L', .15); v.setBias('n_R', .15); v.connect('m_FL', 'n_L', +1); v.connect('m_FR', 'n_R', +1); },
  'Vehicle 2b (aggressor)': v => { clearWiring(v); v.setBias('n_L', .15); v.setBias('n_R', .15); v.connect('m_FR', 'n_L', +1); v.connect('m_FL', 'n_R', +1); },
  'Vehicle 3a (love)': v => { clearWiring(v); v.setBias('n_L', .6); v.setBias('n_R', .6); v.connect('m_FL', 'n_L', -1); v.connect('m_FR', 'n_R', -1); },
  'Vehicle 3b (explorer)': v => { clearWiring(v); v.setBias('n_L', .6); v.setBias('n_R', .6); v.connect('m_FR', 'n_L', -1); v.connect('m_FL', 'n_R', -1); },
};
function clearWiring(v) {
  // ensure default loadout has the two light sensors used by presets
  v.loadout = { m_FL: 'LDR', m_FC: 'IR', m_FR: 'LDR' }; v._rebuildSensors();
  for (const n of v.neurons) { n.inputs = []; n.bias = 0; }
}
function buildPresets() {
  const box = document.getElementById('presets');
  box.innerHTML = '';
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => { PRESETS[name](vehicle); editor.layout(); editor.draw(); });
    box.appendChild(b);
  }
}

// ── Arena rendering / tools ──
function drawArena() { renderer.draw(vehicle, { showCones, showGrid: editMode_arenaEditing() }); }
function editMode_arenaEditing() { return !running; }  // show grid when not running

document.querySelectorAll('#arena-tools .tool').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#arena-tools .tool').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); tool = b.dataset.tool;
    const hints = { light: 'Click the arena to place a light.', wall: 'Click grid cells to add walls.',
                    erase: 'Click a wall to remove it.', robot: 'Click to set the robot start; click again to set its heading.' };
    document.getElementById('tool-hint').textContent = hints[tool];
    robotPlaceStage = 0;
  });
});

let robotPlaceStage = 0;
arenaCanvas.addEventListener('click', e => {
  if (running) return;
  const r = arenaCanvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (arenaCanvas.width / r.width);
  const py = (e.clientY - r.top) * (arenaCanvas.height / r.height);
  const w = renderer.toWorld(px, py);
  if (w.x < 0 || w.x > arena.W || w.y < 0 || w.y > arena.H) return;

  if (tool === 'light') {
    arena.addLight(arena.snap(w.x), arena.snap(w.y), 1);
  } else if (tool === 'wall') {
    const gx = Math.floor(w.x / arena.grid), gy = Math.floor(w.y / arena.grid);
    arena.addWallCell(gx, gy);
  } else if (tool === 'erase') {
    // remove nearest internal wall segment
    let best = -1, bestD = 0.05;
    arena.walls.forEach((wl, i) => {
      if (i < 4) return; // keep boundary
      const d = segDist(w.x, w.y, wl);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) arena.walls.splice(best, 1);
  } else if (tool === 'robot') {
    if (robotPlaceStage === 0) {
      arena.robotStart.x = arena.snap(w.x); arena.robotStart.y = arena.snap(w.y);
      robotPlaceStage = 1;
      document.getElementById('tool-hint').textContent = 'Now click to set the heading.';
    } else {
      const dx = w.x - arena.robotStart.x, dy = w.y - arena.robotStart.y;
      arena.robotStart.heading = Math.atan2(dy, dx);
      robotPlaceStage = 0;
      document.getElementById('tool-hint').textContent = 'Robot start set. Place lights/walls or Run.';
    }
    spawnVehicle();
  }
  drawArena();
});

function segDist(px, py, w) {
  const ex = w.x2 - w.x1, ey = w.y2 - w.y1, len2 = ex * ex + ey * ey;
  let t = len2 ? ((px - w.x1) * ex + (py - w.y1) * ey) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (w.x1 + t * ex), py - (w.y1 + t * ey));
}

// ── Run loop ──
function step(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.05); lastT = t;
  const readings = vehicle.readSensors(arena.lights, arena.walls);
  const m = vehicle.evaluate(readings);
  driveStep(vehicle, m.L, m.R, dt, arena.walls);
  renderer.pushTrail(vehicle.x, vehicle.y);
  if (recording) recordData.frames.push({ x: +vehicle.x.toFixed(4), y: +vehicle.y.toFixed(4), h: +vehicle.heading.toFixed(4) });
  renderer.draw(vehicle, { showCones, showGrid: false });
  raf = requestAnimationFrame(step);
}
function doRun() {
  running = !running;
  const btn = document.getElementById('btn-run');
  if (running) { btn.textContent = '⏸ Pause'; btn.classList.add('running'); lastT = performance.now(); raf = requestAnimationFrame(step); }
  else stopRun();
}
function stopRun() {
  running = false;
  const btn = document.getElementById('btn-run');
  if (btn) { btn.textContent = '▶ Run'; btn.classList.remove('running'); }
  if (raf) cancelAnimationFrame(raf);
}
function doReset() { stopRun(); spawnVehicle(); renderer.clearTrail(); drawArena(); }

// ── Record / export ──
function doRecord() {
  recording = !recording;
  const btn = document.getElementById('btn-record'), status = document.getElementById('rec-status');
  if (recording) {
    recordData = { meta: { arena: { W: arena.W, H: arena.H }, lights: arena.lights.map(l => ({ ...l })) }, vehicle: vehicle.toJSON(), frames: [] };
    btn.classList.add('running'); btn.textContent = '■ Stop'; status.textContent = 'Recording…';
    document.getElementById('btn-export').disabled = true;
  } else {
    btn.classList.remove('running'); btn.textContent = '● Record';
    status.textContent = recordData ? `${recordData.frames.length} frames` : '';
    document.getElementById('btn-export').disabled = !recordData || recordData.frames.length === 0;
  }
}
function doExport() {
  if (!recordData) return;
  const blob = new Blob([JSON.stringify(recordData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'byov_run.json'; a.click();
  URL.revokeObjectURL(url);
}

// ── Wire controls ──
document.getElementById('btn-run').addEventListener('click', doRun);
document.getElementById('btn-reset').addEventListener('click', doReset);
document.getElementById('btn-record').addEventListener('click', doRecord);
document.getElementById('btn-export').addEventListener('click', doExport);
document.getElementById('btn-clear-lights').addEventListener('click', () => { arena.clearLights(); drawArena(); });
document.getElementById('btn-clear-walls').addEventListener('click', () => { arena.clearWalls(); drawArena(); });
document.getElementById('chk-cones').addEventListener('change', e => { showCones = e.target.checked; drawArena(); });
editor.onChange = () => {};

// ── Init ──
buildPresets();
PRESETS['Vehicle 2b (aggressor)'](vehicle);
editor.layout(); editor.draw();
showBuild();
