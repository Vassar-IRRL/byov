# BYOV — Build Your Own Vehicle (web)

A browser-based Braitenberg-vehicle simulator: wire directional sensors to
motors and watch the vehicle behave. A digital twin of the physical PAW lab
AnaBBot — sensors model real directionality (cone of operation), not the
omnidirectional approximation BugWorks used.

## Run it
Hosted: open the GitHub Pages link for this repo.

## Local testing
This app uses ES modules, which browsers block over `file://`. To test locally,
serve the folder over http, e.g.:

    python3 -m http.server 8000

then open http://localhost:8000 . (Double-clicking index.html will NOT work
because of the module sandbox — hosting over http, like GitHub Pages, is
required.)

## Files
- index.html / style.css — UI
- sim.js     — physics: differential drive + DIRECTIONAL sensors (the core)
- vehicle.js — body, sensors, neurons (v1 model), motors, wiring evaluation
- arena.js   — world + canvas rendering
- app.js     — UI glue, main loop, presets, record/export

## v1 model (per BYOV_WEB_SPEC.md)
- One AnaBBot-inspired body; LDR (70° cone) + IR (narrow beam) sensors.
- Neuron: N = clamp(bias + Σ(±1 × sensor signal), 0, 1). Bias in [-1, 1].
  Wire sign by E/I header; no per-wire gains; N output only.
- Presets cover Braitenberg Vehicles 1, 2a, 2b, 3a, 3b.
