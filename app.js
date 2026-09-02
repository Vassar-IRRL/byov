/* app.js — two-screen BYOV: Build (robot+wiring) and Arena&run.
 */
import { Vehicle } from './vehicle.js?v=14';
import { Arena, Renderer } from './arena.js?v=14';
import { EditorView } from './editor_view.js?v=14';
import { driveStep } from './sim.js?v=14';

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
let replay = null;          // { data, frame, playing, saved } when in replay mode
let lightColor = 'white';   // colour of newly-placed lights

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
  if (replay) exitReplay();
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
// A preset is DATA about one vehicle -- how many neurons it needs, what the
// pot is set to, and how it is wired -- not a sequence of clicks. The RESET
// deliberately lives in applyPreset(), not in the definitions, so the planned
// "add this vehicle to what I already have" mode is a flag on the applier
// rather than a rewrite of all five.
//
// 1, 2a and 2b wire sensors STRAIGHT to motors. Motors have a FORWARD and a
// REVERSE bank (like the board's FL/BL, FR/BR); there is no excite/inhibit at
// a motor, you choose the direction.
//
// 3a and 3b are the ones with a SIGN on the connection, and that sign is an
// INHIBITORY NEURON between the sensor and its motor -- not a wire into the
// reverse bank. The difference shows up under a strong stimulus: a neuron
// clamps to [0, 1], so the motor slows to a stop, whereas a reverse wire keeps
// subtracting past zero and drives the motor backwards.
const PRESETS = {
  'Vehicle 1 (alive)': { neurons: 0, bias: 0, wire: v => {
    v.connect('LDR_L', 'L', 'fwd', 'blue'); v.connect('LDR_L', 'R', 'fwd', 'blue'); } },

  'Vehicle 2a (coward)': { neurons: 0, bias: .15, wire: v => {
    v.connect('LDR_L', 'L', 'fwd', 'blue'); v.connect('LDR_R', 'R', 'fwd', 'blue'); } },

  'Vehicle 2b (aggressor)': { neurons: 0, bias: .15, wire: v => {
    v.connect('LDR_R', 'L', 'fwd', 'blue'); v.connect('LDR_L', 'R', 'fwd', 'blue'); } },

  // SAME-SIDE inhibition: light to port slows the PORT motor, so the vehicle
  // turns toward the light and comes to rest facing it.
  'Vehicle 3a (love)': { neurons: 2, bias: 0, neuronBias: .6, wire: (v, N) => {
    v.connect('LDR_L', N[0], -1, 'blue'); v.connect(N[0], 'L', 'fwd', 'blue');
    v.connect('LDR_R', N[1], -1, 'blue'); v.connect(N[1], 'R', 'fwd', 'blue'); } },

  // CROSSED inhibition: light to port slows the STARBOARD motor, so the
  // vehicle turns away and moves on.
  'Vehicle 3b (explorer)': { neurons: 2, bias: 0, neuronBias: .6, wire: (v, N) => {
    v.connect('LDR_L', N[0], -1, 'blue'); v.connect(N[0], 'R', 'fwd', 'blue');
    v.connect('LDR_R', N[1], -1, 'blue'); v.connect(N[1], 'L', 'fwd', 'blue'); } },
};

/* Neuron ids for a preset to use. Replace mode starts from the board's
 * existing neurons (their inputs are already severed) and adds any shortfall;
 * additive mode would append fresh ones instead. Returns fewer ids than asked
 * for only if MAX_NEURONS is in the way. */
function ensureNeurons(v, count, keepExisting) {
  const from = keepExisting ? v.neurons.length : 0;
  while (v.neurons.length < from + count) if (!v.addNeuron()) break;
  return v.neurons.slice(from, from + count).map(n => n.id);
}

/* Apply a preset. A preset is a fully canned vehicle: by default it REPLACES
 * the board -- stock sensors back at their stock slots, all wiring severed,
 * the pot reset -- because it describes one specific machine, not an addition
 * to yours.
 *
 * keepExisting is the seam for the planned compose mode (pick one or more
 * presets, tick "keep current work", hit generate). Nothing calls it with true
 * yet; it is here so that feature does not have to reopen the definitions. */
function applyPreset(name, v, { keepExisting = false } = {}) {
  const p = PRESETS[name];
  if (!p) return;
  if (!keepExisting) { v.resetMounts(); v.clearWiring(); }
  const N = ensureNeurons(v, p.neurons, keepExisting);
  for (const id of N) v.setNeuronBias(id, p.neuronBias ?? 0);
  v.setBias(p.bias ?? 0);
  p.wire(v, N);
}

// ── Preset gating ──
// Presets start LOCKED: a preset is the answer to an exercise, so it stays out
// of reach until the student says they have built that vehicle themselves.
// This is deliberately on the honour system -- there is no wiring check -- so
// an instructor, not the program, decides whether the claim holds.
const BUILT_KEY = 'byov.presetsBuilt';

function loadBuilt() {
  try { return new Set(JSON.parse(localStorage.getItem(BUILT_KEY) || '[]')); }
  catch (e) { return new Set(); }        // private mode / storage disabled
}
function saveBuilt(set) {
  try { localStorage.setItem(BUILT_KEY, JSON.stringify([...set])); } catch (e) {}
}
let presetsBuilt = loadBuilt();

function buildPresets() {
  const box = document.getElementById('presets');
  box.innerHTML = '';
  for (const name of Object.keys(PRESETS)) {
    const unlocked = presetsBuilt.has(name);

    const row = document.createElement('div');
    row.className = 'preset-row';

    const b = document.createElement('button');
    b.textContent = name;
    b.className = 'preset-load';
    b.disabled = !unlocked;
    b.title = unlocked ? 'Load this wiring'
                       : 'Locked — build this vehicle yourself, then tick to unlock';
    b.addEventListener('click', () => {
      applyPreset(name, vehicle); editor.layout(); editor.draw();
    });

    const mark = document.createElement('button');
    mark.className = 'preset-mark' + (unlocked ? ' on' : '');
    mark.textContent = unlocked ? '✓' : '○';
    mark.title = unlocked ? 'Built — click to lock again' : 'I built this: unlock the preset';
    mark.addEventListener('click', () => {
      if (presetsBuilt.has(name)) presetsBuilt.delete(name);
      else presetsBuilt.add(name);
      saveBuilt(presetsBuilt);
      buildPresets();
    });

    row.appendChild(b);
    row.appendChild(mark);
    box.appendChild(row);
  }
}

// ── Arena rendering / tools ──
function drawArena() { renderer.draw(vehicle, { showCones, showGrid: editMode_arenaEditing(), showHeadingArrow: editMode_arenaEditing() && !replay, running }); }
function editMode_arenaEditing() { return !running; }  // show grid when not running

document.querySelectorAll('#arena-tools .tool').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#arena-tools .tool').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); tool = b.dataset.tool;
    const hints = { light: 'Click the arena to place a light.', 'erase-light': 'Click a light to remove it.',
                    wall: 'Click grid cells to add walls.', erase: 'Click a wall to remove it.',
                    robot: 'Click to place the robot, then drag from it to aim (drag direction = front).' };
    document.getElementById('tool-hint').textContent = hints[tool];
    // show the light-colour picker only for the light tool
    const cr = document.getElementById('light-color-row');
    if (cr) cr.style.display = (tool === 'light') ? 'flex' : 'none';
    robotPlaceStage = 0;
  });
});

// light-colour swatch selection
document.querySelectorAll('#light-colors .sw').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#light-colors .sw').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    lightColor = b.dataset.color;
  });
});

let robotPlaceStage = 0;
arenaCanvas.addEventListener('click', e => {
  if (running || replay) return;
  const r = arenaCanvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (arenaCanvas.width / r.width);
  const py = (e.clientY - r.top) * (arenaCanvas.height / r.height);
  const w = renderer.toWorld(px, py);
  if (w.x < 0 || w.x > arena.W || w.y < 0 || w.y > arena.H) return;

  if (tool === 'light') {
    arena.addLight(arena.snap(w.x), arena.snap(w.y), 1, lightColor);
  } else if (tool === 'erase-light') {
    // remove the nearest light to the click (generous radius — the glow is big)
    let best = -1, bestD = 0.20;
    arena.lights.forEach((L, i) => {
      const d = Math.hypot(L.x - w.x, L.y - w.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) arena.lights.splice(best, 1);
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
    // Single click places the robot at the click point; heading is then set by
    // DRAGGING (handled in mousedown/mousemove/mouseup below). One click = place.
    arena.robotStart.x = arena.snap(w.x);
    arena.robotStart.y = arena.snap(w.y);
    spawnVehicle();
    document.getElementById('tool-hint').textContent =
      'Placed. Now DRAG from the robot to aim it (drag direction = front).';
  }
  drawArena();
});

// Drag-to-aim: when the robot tool is active, dragging sets the start heading.
let aiming = false;
function arenaXY(e) {
  const r = arenaCanvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (arenaCanvas.width / r.width);
  const py = (e.clientY - r.top) * (arenaCanvas.height / r.height);
  return renderer.toWorld(px, py);
}
arenaCanvas.addEventListener('mousedown', e => {
  if (running || replay || tool !== 'robot') return;
  const w = arenaXY(e);
  // start aiming if pressing near the robot start
  if (Math.hypot(w.x - arena.robotStart.x, w.y - arena.robotStart.y) < 0.18) {
    aiming = true;
    document.getElementById('tool-hint').textContent = 'Aiming… release to set the front direction.';
  }
});
arenaCanvas.addEventListener('mousemove', e => {
  if (!aiming) return;
  const w = arenaXY(e);
  const dx = w.x - arena.robotStart.x, dy = w.y - arena.robotStart.y;
  if (Math.hypot(dx, dy) > 0.02) { arena.robotStart.heading = Math.atan2(dy, dx); spawnVehicle(); drawArena(); }
});
arenaCanvas.addEventListener('mouseup', () => {
  if (aiming) { aiming = false; document.getElementById('tool-hint').textContent = 'Robot aimed. Drag again to re-aim, or pick another tool.'; }
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
  const m = vehicle.evaluate(readings);      // also refreshes meter values
  driveStep(vehicle, m.L, m.R, dt, arena.walls);
  renderer.pushTrail(vehicle.x, vehicle.y);
  if (recording) recordData.frames.push({ x: +vehicle.x.toFixed(4), y: +vehicle.y.toFixed(4), h: +vehicle.heading.toFixed(4) });
  renderer.draw(vehicle, { showCones, showGrid: false, running: true });
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
    recordData = { meta: { arena: { W: arena.W, H: arena.H, grid: arena.grid },
                           lights: arena.lights.map(l => ({ ...l })),
                           walls: arena.walls.map(w => ({ ...w })),
                           robotStart: { ...arena.robotStart } },
                   vehicle: vehicle.toJSON(), frames: [] };
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

// ── Import + replay mode (pure playback of a recorded run) ──────────────────

function doImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch { document.getElementById('rec-status').textContent = 'Could not read that file.'; return; }
    if (!data.frames || !data.frames.length || !data.meta) {
      document.getElementById('rec-status').textContent = 'That file has no recorded frames.'; return;
    }
    try {
      enterReplay(data, file.name);
      document.getElementById('rec-status').textContent = 'Replaying ' + file.name + '.';
    } catch (err) {
      document.getElementById('rec-status').textContent = 'Import failed: ' + err.message;
    }
  };
  reader.readAsText(file);
}

function enterReplay(data, name) {
  stopRun();
  // Save the user's current arena + vehicle so we can restore on exit.
  const saved = {
    lights: arena.lights.map(l => ({ ...l })),
    walls: arena.walls.map(w => ({ ...w })),
    robotStart: { ...arena.robotStart },
    vehicle: vehicle.toJSON(),
  };
  // Load the recorded arena (pure playback: we draw recorded poses).
  arena.lights = (data.meta.lights || []).map(l => ({ ...l }));
  arena.walls = (data.meta.walls && data.meta.walls.length) ? data.meta.walls.map(w => ({ ...w })) : arena._boundary();
  if (data.vehicle) vehicle.loadJSON(data.vehicle);

  replay = { data, frame: 0, playing: false, saved };
  document.getElementById('replay-panel').classList.remove('hidden');
  document.getElementById('replay-name').textContent = (name || 'recording') + ' — ' + data.frames.length + ' frames';
  const scrub = document.getElementById('replay-scrub');
  scrub.max = data.frames.length - 1; scrub.value = 0;
  // disable editing tools while in replay
  setArenaToolsEnabled(false);
  document.getElementById('btn-run').disabled = true;
  document.getElementById('btn-record').disabled = true;
  renderReplayFrame(0);
}

function renderReplayFrame(i) {
  const f = replay.data.frames[i];
  if (!f) return;
  vehicle.x = f.x; vehicle.y = f.y; vehicle.heading = f.h;
  // recompute sensor readings from the recorded arena so cones are faithful
  vehicle.evaluate(vehicle.readSensors(arena.lights, arena.walls));  // refresh meters
  // trail up to current frame
  renderer.clearTrail();
  for (let k = 0; k <= i; k++) renderer.pushTrail(replay.data.frames[k].x, replay.data.frames[k].y);
  renderer.draw(vehicle, { showCones, showGrid: false, running: true });
  replay.frame = i;
  document.getElementById('replay-scrub').value = i;
  document.getElementById('replay-frame').textContent = 'frame ' + i + ' / ' + (replay.data.frames.length - 1);
}

let replayRaf = null;
function replayPlay() {
  if (!replay) return;
  replay.playing = !replay.playing;
  const btn = document.getElementById('btn-replay-play');
  if (replay.playing) {
    btn.textContent = '⏸ Pause';
    if (replay.frame >= replay.data.frames.length - 1) replay.frame = 0;
    const tick = () => {
      if (!replay || !replay.playing) return;
      if (replay.frame >= replay.data.frames.length - 1) { replay.playing = false; btn.textContent = '▶ Play'; return; }
      renderReplayFrame(replay.frame + 1);
      replayRaf = requestAnimationFrame(tick);
    };
    replayRaf = requestAnimationFrame(tick);
  } else {
    btn.textContent = '▶ Play';
    if (replayRaf) cancelAnimationFrame(replayRaf);
  }
}

function exitReplay() {
  if (!replay) return;
  if (replayRaf) cancelAnimationFrame(replayRaf);
  // restore the user's saved arena + vehicle
  const s = replay.saved;
  arena.lights = s.lights; arena.walls = s.walls; arena.robotStart = s.robotStart;
  vehicle.loadJSON(s.vehicle);
  spawnVehicle(); renderer.clearTrail();
  replay = null;
  document.getElementById('replay-panel').classList.add('hidden');
  setArenaToolsEnabled(true);
  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-record').disabled = false;
  drawArena();
}

function setArenaToolsEnabled(on) {
  document.querySelectorAll('#arena-tools .tool').forEach(b => b.disabled = !on);
  ['btn-clear-lights', 'btn-clear-walls', 'btn-reset', 'btn-export', 'btn-import']
    .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !on ? true : el.id === 'btn-export' ? (!recordData) : false; });
}

// ── Wire controls ──
document.getElementById('btn-run').addEventListener('click', doRun);
document.getElementById('btn-reset').addEventListener('click', doReset);
document.getElementById('btn-record').addEventListener('click', doRecord);
document.getElementById('btn-export').addEventListener('click', doExport);
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) doImport(e.target.files[0]);
  e.target.value = '';   // allow re-importing the same file
});
document.getElementById('btn-replay-play').addEventListener('click', replayPlay);
document.getElementById('btn-replay-exit').addEventListener('click', exitReplay);
document.getElementById('replay-scrub').addEventListener('input', e => {
  if (!replay) return;
  if (replay.playing) replayPlay();   // pause when scrubbing
  renderReplayFrame(parseInt(e.target.value, 10));
});
document.getElementById('btn-clear-lights').addEventListener('click', () => { arena.clearLights(); drawArena(); });
document.getElementById('btn-clear-walls').addEventListener('click', () => { arena.clearWalls(); drawArena(); });
document.getElementById('chk-cones').addEventListener('change', e => { showCones = e.target.checked; drawArena(); });
editor.onChange = () => {};

// ── Init ──
buildPresets();
// The vehicle starts UNWIRED. It used to boot with Vehicle 2b applied, which
// would now hand out the answer to a locked preset before the student starts.
vehicle.resetMounts();
editor.layout(); editor.draw();
showBuild();
