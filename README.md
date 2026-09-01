# BYOV — Build Your Own Vehicle (web)

A browser-based Braitenberg-vehicle simulator and digital twin of the physical
PAW lab AnaBBot. Sensors model real directionality (cone of operation), unlike
BugWorks' omnidirectional approximation.

## Two screens (toggle in the header)
- **Build robot** — the rectangular AnaBBot drawn top-down (motors on the sides,
  sensors at the front). Overlaid wiring editor: by DEFAULT you drag a wire from
  a front sensor straight to a motor's FORWARD or REVERSE bank (four sockets
  each, like the board's FL/BL and FR/BR) — no neurons involved. Motors have no
  excite/inhibit: you choose a direction, and a reverse wire subtracts from
  forward, exactly as (FL - BL) in engine/vehicle.py. Wire COLOUR is WEIGHT (blue 1x, green 2x, red 3x), matching
  the physical board and engine/signals.py; excite vs inhibit comes from which
  input the wire lands on. Meters M1/M2/M3 are permanently installed, take one
  wire each and are display only. One shared pot between the motors sets a
  resting speed. Neurons are OPTIONAL: the +/- buttons beside the robot add and
  remove them (up to 6, LIFO), laid out 3 rows of 2 like the board.

  SENSORS are yours to place. Up to eight mount on a 24-slot ring around the
  chassis, 15 degrees apart. Drag a sensor module to slide it round the hull,
  scroll over it to rotate its aim one step, and use the +/- pair on the deck
  to add and remove. Position and aim are independent: sliding a sensor keeps
  its angle relative to the hull, and you can aim one anywhere you like.

  PRESETS START LOCKED. Each is the answer to an exercise, so it stays greyed
  out until you tick the marker beside it to say you built that vehicle
  yourself. It is the honour system — nothing checks your wiring, which is
  what lets an equivalent-but-different solution count. Loading a preset
  restores the stock four sensors, so anything you placed is replaced.

## Run it
Hosted: open the GitHub Pages link for this repo. (Must be served over http —
ES modules are blocked over file://. Locally: `python3 -m http.server` then open
http://localhost:8000 .)

## Files
- index.html / style.css — two-screen UI
- sim.js         — physics: differential drive + DIRECTIONAL sensors (core)
- vehicle.js     — body, front mounts, optional neurons, meters, weighted wiring
- editor_view.js — Screen 1: robot, sensor placement, wiring editor
- arena.js       — world, grid editing, canvas rendering
- app.js         — screen toggle, tools, run loop, presets, record/export
