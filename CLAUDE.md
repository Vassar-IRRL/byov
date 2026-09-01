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
cached copy.** All module specifiers in `index.html` carry it and they are
currently at `?v=7`. This is the single most common way a change appears not to
have shipped.

---

## Files

| file | holds |
|---|---|
| `index.html` | markup, controls, module imports with `?v=N` |
| `app.js` | wiring UI, presets, top-level glue |
| `sim.js` | physics + sensor models. **All tunable constants live here.** |
| `vehicle.js` | the vehicle: sensors, neurons, motors, signal flow |
| `arena.js` | arena state, lights, walls, rendering |
| `editor_view.js` | arena editor — place/erase lights, walls, robot |
| `style.css` | all styling |

---

## Scope — read this before editing

This repo is BYOV **only**. It is deliberately separate from the main
PAW-Robotics suite, which is a Python/pygame project plus Arduino firmware.
Do not import from it, mirror its structure, or try to keep the two in step
automatically.

**But the main suite contains `byov_web/`, an older copy of these same files.**
As of this writing the two match on features but NOT on physics constants (see
below). If a change here should also apply there, say so explicitly — it will
not happen on its own, and nothing checks.

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

### These constants are KNOWN to disagree with the physical robot

The main project measured the hardware and revised its own figures. BYOV was
not updated. Current known differences:

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

- **Wire colour is weight**, not sign: blue 1×, green 2×, red 3×. Left-click a
  wire cycles it, right-click removes.
- **Motors have FWD and REV banks** of 4 sockets each. There is no
  excite/inhibit on motors; direction is which bank the wire lands in.
  `motor = clamp(sharedBias + Σfwd − Σrev, −1, 1)`.
- **Neurons are optional.** Default wiring is sensor → motor direct. Max 6,
  added and removed last-in-first-out. Neurons DO have E/I inputs.
- **Meters M1–M3** are display only. One wire each. They never affect motors.
- **One shared bias pot** between the motors sets a resting speed. There are no
  per-motor pots.
- Presets rewire sensor → motor directly. **Presets must not delete neurons** —
  they sever wires but leave neurons, their biases, and meter wiring intact.
  The shared pot does reset, because each preset sets it deliberately.
- Double-click a sensor to change type (LDR → IR → none). Single-click an LDR
  cycles its colour channel R → G → B → W.

---

## Working style

- **No build step, and keep it that way.** Plain modules are why this deploys
  by pushing.
- **Verify in a browser before claiming a change works.** There are no tests.
- Prefer small commits — Pages deploys whatever lands on the default branch.
- When touching `sim.js`, state plainly what changed numerically. Silent
  constant drift is the failure mode this project has hit repeatedly.
