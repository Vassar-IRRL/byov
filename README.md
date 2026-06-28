# BYOV — Build Your Own Vehicle (web)

A browser-based Braitenberg-vehicle simulator and digital twin of the physical
PAW lab AnaBBot. Sensors model real directionality (cone of operation), unlike
BugWorks' omnidirectional approximation.

## Two screens (toggle in the header)
- **Build robot** — the rectangular AnaBBot drawn top-down (motors on the sides,
  sensors at the front). Overlaid neuron/wiring editor: drag a wire from a front
  sensor to a neuron's E (excite) or I (inhibit) input; each neuron drives its
  motor; drag a trimpot for bias. Double-click a sensor to change its type
  (LDR / IR / none). Presets build Braitenberg Vehicles 1–3b.
- **Arena & run** — full-screen grid arena. Tools: place lights, add/erase walls
  on the grid, place the robot (position + heading). Run / Reset, sensor-cone
  toggle, and Record → Export (JSON) for lab write-ups.

## Run it
Hosted: open the GitHub Pages link for this repo. (Must be served over http —
ES modules are blocked over file://. Locally: `python3 -m http.server` then open
http://localhost:8000 .)

## Files
- index.html / style.css — two-screen UI
- sim.js         — physics: differential drive + DIRECTIONAL sensors (core)
- vehicle.js     — rectangular body, fixed front mounts, neurons (v1), wiring
- editor_view.js — Screen 1: robot + wiring editor (drag-to-connect)
- arena.js       — world, grid editing, canvas rendering
- app.js         — screen toggle, tools, run loop, presets, record/export
