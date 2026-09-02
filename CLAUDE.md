# BYOV — Build Your Own Vehicle

A browser simulator of the PAW lab robot. Wire sensors to motors, run the
vehicle in an arena, record and replay. Deployed to GitHub Pages at
https://vassar-irrl.github.io/byov/

Plain ES modules, no build step, no framework, no package manager. Open
`index.html` through a local HTTP server and it runs.

---

## Run it locally

ES modules need a real server — `file://` will not work.

```
python -m http.server 8000
```

then http://localhost:8000

## Deploy

Commit and push. Pages is already configured; there is no build.

**Bump the `?v=N` on every changed JS/CSS import or the browser serves a stale
cached copy.** This is the single most common way a change appears not to have
shipped.

The version tags are NOT all in `index.html` — seven of the nine live in JS
`import` statements. All 9 sites, currently all at `?v=11`:

| file | line | specifier |
|---|---|---|
| `index.html` | 7 | `style.css?v=11` |
| `index.html` | 99 | `app.js?v=11` |
| `app.js` | 3 | `./vehicle.js?v=11` |
| `app.js` | 4 | `./arena.js?v=11` |
| `app.js` | 5 | `./editor_view.js?v=11` |
| `app.js` | 6 | `./sim.js?v=11` |
| `arena.js` | 5 | `./sim.js?v=11` |
| `editor_view.js` | 24 | `./vehicle.js?v=11` |
| `vehicle.js` | 25 | `./sim.js?v=11` |

Bumping only `index.html` busts `style.css` and `app.js` and nothing else — a
changed `sim.js` is still served from cache, which looks exactly like "my edit
didn't ship". Bump all 9 together:

```
grep -rn "?v=" index.html *.js            # see the current state
sed -i 's/?v=11/?v=15/g' index.html *.js    # bump them all
```

A mismatch is worse than a stale copy: `app.js` and `editor_view.js` both
import `vehicle.js`, so if their tags disagree the browser loads **two separate
module instances** of it.

---

## Files

| file | holds |
|---|---|
| `index.html` | markup, controls, 2 of the 9 `?v=N` tags |
| `app.js` | top-level glue: screen toggle, presets + their lock state, run loop, record/replay, **and the arena editing tools** (place/erase lights and walls, place robot) |
| `sim.js` | physics + sensor models. **All PHYSICS constants live here** — but not every tunable in the project; see below. |
| `vehicle.js` | the vehicle: sensors, neurons, motors, signal flow |
| `arena.js` | arena state, lights, walls, rendering |
| `editor_view.js` | **Screen 1 — the robot wiring editor** (drag-to-connect, and sensor placement on the ring). Not the arena editor. |
| `style.css` | all styling |
| `README.md` | public-facing description of the same material. Prose, not a spec — it restates the conventions below, so it drifts. Update both or neither. |

---

## Scope — read this before editing

This repo is BYOV **only**, and it is the only web copy. It is deliberately
separate from the main PAW-Robotics suite, which is a Python/pygame project
plus Arduino firmware. Do not import from it, mirror its structure, or try to
keep the two in step automatically.

There is no parallel `byov_web/` to keep in sync — an older copy lived in the
main suite and is gone. Nothing here needs mirroring anywhere else.

Two things here still ORIGINATE in the suite, and both are one-time ports that
nothing keeps current: the 16-BIT palette (from `engine/theme.py`) and the
measured robot figures in the comparison table below. If the suite changes
either, it will not reach BYOV on its own.

---

## The model this simulates

A two-wheel differential-drive robot with light and proximity sensors, wired
Braitenberg-style. Constants in `sim.js`:

```js
WHEELBASE:  0.080    // m, distance between wheels
MAX_SPEED:  0.175    // m/s at motor command 1.0
WALL_T:     0.012    // m
BODY_R:     0.045    // m
IR.MIN_RANGE: 0.18   // m — saturates below this
IR.MAX_RANGE: 0.60   // m — reads 0 beyond
```

`sim.js` is the home of the physics constants, but **not of every tunable**.
Before you go looking for a number in `sim.js` that isn't there:

| constant | file | value |
|---|---|---|
| `WIRE_WEIGHT`, `WIRE_COLORS` | `vehicle.js:27` | blue 1 / green 2 / red 3 |
| `MAX_NEURONS` | `vehicle.js:29` | 6 |
| `RING_SLOTS`, `ANGLE_STEP` | `vehicle.js:34` | 24 slots, 15° apart |
| `MAX_SENSORS` | `vehicle.js:36` | 8 |
| `MOTOR_SLOTS` | `vehicle.js:40` | 4 |
| `bodyW`, `bodyL` | `vehicle.js:47` | 0.090, 0.110 m |
| stock mount slots + angles | `vehicle.js:52` | slots 2/1/23/22, ±35° and 0° |
| `SENSOR_OUTSET` | `editor_view.js:37` | 24 px (drawing only) |
| arena size | `arena.js:8` | 1.2 × 1.6 m |
| timestep clamp | `app.js:244` | 0.05 s max per frame |

### Where sensors sit

Sensors are NOT at fixed offsets any more. Each mount is `{ id, slot, angle }`;
its position is **derived** from the slot by `slotPos()`, which projects a ray
from the body centre onto the chassis outline. Slot 0 is dead ahead and slots
advance counter-clockwise (to port) in 15° steps — the same convention as a
sensor's `angle`, which is degrees CCW from body +Y and is stored separately
from the slot.

The stock four are slots 2, 1, 23, 22 at 35°, 0°, 0°, −35°. Moving to the ring
kept every orientation but shifted positions, because the ring sits on the hull
outline (y = 0.055) rather than inset:

| | before | after | moved |
|---|---|---|---|
| `LDR_L` | −0.0380, 0.0500 | −0.0318, 0.0550 | 8.0 mm |
| `IR_L` | −0.0150, 0.0550 | −0.0147, 0.0550 | 0.3 mm |
| `IR_R` | 0.0150, 0.0550 | 0.0147, 0.0550 | 0.3 mm |
| `LDR_R` | 0.0380, 0.0500 | 0.0318, 0.0550 | 8.0 mm |

**Angles are never snapped to the ring.** The stock LDRs sit at ±35°, which is
not a multiple of 15°, so snapping on load or on `setSensorAngle` silently
re-aimed the default vehicle on an export/import roundtrip. Discreteness comes
from `rotateSensor()` stepping by `ANGLE_STEP` instead. If you ever make angles
grid-aligned, the stock vehicle moves — treat it as a physics change.

### These constants are KNOWN to disagree with the physical robot

The main project measured the hardware and revised its own figures. BYOV was
not updated. These are differences from the PHYSICAL ROBOT, recorded when the
suite remeasured it — not from any code copy. Current known differences:

| | BYOV | measured / main project |
|---|---|---|
| `BODY_R` | 0.045 | **0.0775** (155 mm chassis, from CAD) |
| `MAX_SPEED` | 0.175 | **0.35** m/s |
| `WALL_T` | 0.012 | **0.05** |
| `IR.MIN_RANGE` | 0.18 | **0.10**, and the real sensor FOLDS BACK below it — a wall at 4 cm reads like one at ~35 cm, rather than saturating |

**Do not "fix" these as a side effect of another task.** Changing them alters
every wiring a user has already learned, and BYOV is a teaching tool where
predictability matters more than fidelity. If a task calls for aligning them,
that is its own change with its own testing.

---

## Conventions

- **Wire colour is R**, not sign: blue 1×, green 2×, red 3×. Left-click a wire
  cycles it, right-click removes. On the physical robot the colours are
  literally different resistors spliced into the wire, so **user-facing text
  says "R", never "weight"** — weight is neuron jargon and using it for wires
  misleads students about what the hardware does. The internal constant is
  still `WIRE_WEIGHT` in `vehicle.js`; that name is code, not UI copy.
- **Motors have FWD and REV banks** of 4 sockets each. There is no
  excite/inhibit on motors; direction is which bank the wire lands in.
  `motor = clamp(sharedBias + Σfwd − Σrev, −1, 1)`.
- **The vehicle and the arena both boot EMPTY.** No sensors, no neurons, no
  wiring, no lights, no interior walls — `Vehicle.clearSensors()` and an empty
  `Arena.lights`. The student equips the chassis and builds the world; nothing
  is handed to them. `Vehicle.resetMounts()` still exists and still puts the
  stock four back, for anything that wants a known starting machine.
- **Neurons are optional.** Default wiring is sensor → motor direct. Max 6,
  added and removed last-in-first-out. Neurons DO have E/I inputs.
- **Meters M1–M3** are display only. One wire each. They never affect motors.
- **One shared bias pot** between the motors sets a resting speed. There are no
  per-motor pots.
- **PRESETS ARE CURRENTLY SWITCHED OFF.** `PRESETS_ENABLED = false` in
  `app.js` hides the whole sidebar section. The code below is live, not dead —
  flip the flag and the buttons, lock markers and `localStorage` state all work
  again. The bullets that follow describe that switched-off feature; see
  **Planned** for why it is off and what has to be settled first.
- **Presets start LOCKED** and greyed out. Each row has a marker the student
  ticks to claim they built that vehicle; that unlocks the preset, and ticking
  again re-locks it. State is in `localStorage` under `byov.presetsBuilt`
  (`app.js:89`), so it is per browser. It is the **honour system on purpose** —
  there is no wiring or behaviour check, so an instructor decides whether the
  claim holds, and a student who builds something equivalent-but-different is
  never told they are wrong. The app also boots **unwired**: it used to apply
  `Vehicle 2b`, which would hand out a locked preset's answer.
- **A preset is a fully canned vehicle, and applying one REPLACES the board.**
  `applyPreset()` in `app.js` resets the sensor set (`Vehicle.resetMounts()` —
  stock four ids, slots, angles, types, channels), severs all wiring, and sets
  the pot. Anything the student built is gone. That is deliberate: a preset
  describes one specific machine, not an addition to yours.
- **A preset is DATA, not a sequence of clicks**: `{ neurons, bias, neuronBias,
  wire }`. The reset lives in `applyPreset()`, NOT in the definitions, and
  `applyPreset` takes a `keepExisting` flag that nothing passes yet. That is
  the seam for the planned compose mode (see Planned below) — keep it that way,
  because moving the reset back into the definitions closes that door.
- **Presets 1, 2a and 2b wire sensors straight to motors. 3a and 3b do not.**
  Their sign is an INHIBITORY NEURON between each sensor and its motor, which
  is what a signed connection means — NOT a wire into the reverse bank. The
  two differ under a strong stimulus: a neuron clamps to `[0, 1]` so the motor
  slows to a stop, where a reverse wire keeps subtracting past zero and drives
  the motor backwards. 3a is same-side (turns toward the light, comes to rest
  facing it); 3b is crossed (turns away). Both use `neuronBias: .6`, which
  reproduces the cruising speed the old reverse-wire version had.
  Consequence worth knowing: under a perfectly symmetric strong light both
  vehicles stop rather than reverse.
- **Presets write to neurons, but never delete them.** 3a and 3b need two, so
  `ensureNeurons()` reuses the board's existing neurons (their inputs are
  already severed by then) and adds any shortfall, then sets their biases. A
  student's third and later neurons survive untouched; the first two have their
  biases overwritten.
- **Sensors are added, removed, moved and aimed by the student.** Max 8, on a
  24-slot ring around the hull. `+`/`−` inside the deck add and remove (remove
  is LIFO, like neurons); drag a sensor **module** to slide it round the ring;
  drag its inboard **pin** to run a wire; **wheel** over it to rotate 15° a
  step. An occupied slot refuses a move rather than swapping.
- Double-click a sensor to change type (LDR → IR → none).
- **An LDR's colour channel has two bindings**: single-click the sensor, or
  right-click it. Order is `W → R → G → B → W`, starting from the default `W`
  (so the first click gives you R). Right-click is overloaded — on a wire it
  removes the wire, on an LDR header it cycles the channel.

---

## Planned — not built yet

- **Bringing presets back, with 3a/3b done properly.** They are off because
  the canned vehicles were not worth the development time for this baseline,
  and because 3a/3b are unsettled. The decision, after discussion: a signed
  connection should be a wire into the motor's **REVERSE bank**, NOT an
  inhibitory neuron. An earlier commit implemented the neuron version and it is
  still in `PRESETS` — treat it as superseded, not as the intended design.
  The open problem is what "neutral forward" means. A reverse wire subtracts
  from whatever is driving the motor forward, so 3a/3b need a resting forward
  speed for the light to work against, and that speed has to come from
  somewhere: the shared pot (what the old version did, with `bias: .6`), or a
  dedicated always-on input, or something else. Pick that and the rest is a
  few lines. The behaviour to preserve is that a strong stimulus can drive the
  motor NEGATIVE, so the vehicle backs away — which is exactly what the neuron
  version cannot do, since a neuron clamps to `[0, 1]`.

- **Composing presets.** Today a preset replaces everything, so a student who
  builds 2a and then wants to add 3a loses 2a. The intended fix is to select
  one or more presets and hit a *generate* button, with a toggle for whether to
  keep current work. The groundwork is in place: preset definitions are data,
  the reset lives in `applyPreset()`, and `applyPreset(name, v, { keepExisting:
  true })` already skips the reset and appends fresh neurons rather than reusing
  existing ones. What is missing is the UI (multi-select, the toggle, the
  button) and a decision about what "combining" two vehicles means when both
  want to drive the same motor bank — the banks hold `MOTOR_SLOTS` wires each,
  so two presets can coexist there, but the result is a sum, not a layering.

---

## Known issues

Neither of these misbehaves at runtime today. Both are drift traps: two places
hold one fact, and nothing tells you when they stop agreeing.

- **`bodyW / 2` must equal `BODY_R`, and nothing enforces it.** This got more
  load-bearing: `slotPos()` derives every sensor position from `bodyW`/`bodyL`,
  so the two now disagree about the hull in more places. `vehicle.js:47`
  sets `bodyW = 0.090` (the body drawn on screen); `sim.js` sets
  `BODY_R = 0.045` (the circle used for wall collision). They agree by hand,
  not by construction. Change one alone and the robot visibly clips through
  walls, or stops short of them, with both files looking correct in isolation.
- **The 16-BIT palette is written down in three places.** `style.css` `:root`
  holds it for the DOM, `COL` in `editor_view.js` for the robot canvas, and the
  literals in `arena.js` for the arena canvas. It is ported from
  `engine/theme.py` (`"sixteenbit"`) in the PAW-Robotics suite, which is a
  fourth copy that nothing syncs. Retheming means editing all three here.
  Within that, one pairing is exact: the `.sw-*` swatches in `style.css` are a
  preview of `LIGHT_RGB` in `arena.js`, so if they drift the picker shows a
  colour the arena will not draw.
- **`WIRE_COL` in `editor_view.js` still restates the wire colour set.** It
  holds the hex for each weight colour, which is presentation and belongs to
  the view, but the SET of colours is owned by `WIRE_COLORS` in `vehicle.js`.
  Add a fourth weight there and the editor silently draws it with the fallback
  blue. The old `SLOTS = 4` duplicate is gone — `editor_view.js` now imports
  `MOTOR_SLOTS`, `MAX_NEURONS`, `MAX_SENSORS` and `RING_SLOTS`.
- **Only the canvas CORNERS are safe for chrome outside the hull.** The ring
  can put a sensor anywhere on the deck perimeter, so most of the margin is
  reachable by a sensor module — a port-side one used to land on the neuron
  `+`/`−` buttons and make them unclickable. The corners stay clear because a
  module is pushed out *radially from the deck centre*, so one mounted near a
  deck corner travels diagonally. Sensor `+`/`−` sit top-left, neuron `+`/`−`
  bottom-left. Put anything else clickable in the margin and a sensor will
  eventually cover it.

---

## Working style

- **No build step, and keep it that way.** Plain modules are why this deploys
  by pushing.
- **Verify in a browser before claiming a change works.** There are no tests.
- Prefer small commits — Pages deploys whatever lands on the default branch.
- When touching `sim.js`, state plainly what changed numerically. Silent
  constant drift is the failure mode this project has hit repeatedly.
