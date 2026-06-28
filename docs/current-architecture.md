# Current Architecture — Canvas2D Particle System

> Status: **prototype**. This document describes the system as it exists today
> (`client/src/particle-system/`). It is intentionally descriptive, not
> prescriptive — see [`target-architecture.md`](./target-architecture.md) for
> where it is going and why.

## 1. Purpose

The particle system renders the site's landing experience. Text elements
(`#biotext`, `#projectstext`, `#othertext`) are captured to pixels, those
pixels become **particle targets**, and a swarm of particles animates between
states:

```
ring orbit  ──click──▶  explode  ──▶  fly to text  ──▶  hand off to real HTML
     ▲                                                          │
     └──────────────── transition (nav button) ◀───────────────┘
```

The particles are never the final content — once they "arrive" at a text shape
the canvas fades out and the real, accessible HTML element fades in
(`fadeToHtml`). The particles are an entrance/transition flourish.

## 2. Module map

All files live in `client/src/particle-system/`.

| File | Responsibility |
| --- | --- |
| `main.js` | Composition root. Wires canvases, captures targets, constructs animators, binds DOM events, drives the sequence. |
| `particleSystem.js` | `Particle` data class, spawn strategies, target sampling, `renderParticles` (the draw call). |
| `animator.js` | `ParticleAnimator` (RAF loop) + the per-frame animation functions (`moveParticlesTowardsTarget`, `moveParticlesInOrbit`, `explodeParticles`, `moveParticlesInCircle`). |
| `sampleElement.js` | `drawElement` (html2canvas capture) + `samplePixels` (read non-transparent pixels back). |
| `transition.js` | `assignTransitionTargets` (match/spawn/kill particles for a new target set) + `fadeToHtml`. |
| `canvas.js` | `RenderingContext` wrapper, `createRenderingContext`, `resizeCanvas` (DPR-aware). |
| `utils.js` | Canvas clearing + a family of DOM fade/pulse helpers. |

There is also an empty WebGL stub at `client/src/gl-particle-system/`
(`main.js` just clears a GL context; `utils.js` is a copy of the Canvas2D
`utils.js`).

## 3. Data model

The unit of state is the `Particle` class (`particleSystem.js`):

```js
class Particle {
  x, y                 // current position (CSS pixels)
  targetX, targetY     // where it wants to be
  radius, targetRadius // current / desired size
  color, targetColor   // { r, g, b } current / desired
}
```

This is **array-of-structs (AoS)**: the system holds a plain JS array of these
objects. Critically, behaviors **monkey-patch extra fields onto the instance**
on first touch:

- `moveParticlesTowardsTarget` adds `currentSpeed`.
- `moveParticlesInOrbit` adds `baseRadius`, `baseAngle`, `angle`.
- `explodeParticles` adds `explodeVX`, `explodeVY`.
- `transition.js` adds `dying`.

So a particle's true shape is implicit and depends on which behaviors have run.
This works but it is opaque, and it is the single biggest obstacle to a GPU
port (the GPU wants flat, homogeneous, struct-of-arrays buffers).

### Coordinate space

Everything is in **CSS pixels**. `resizeCanvas` sets the backing store to
`innerWidth * dpr` and then applies `ctx.setTransform(dpr, …)`, so drawing code
works in CSS pixels while the canvas is physically higher-resolution.
`samplePixels` reads the device-pixel buffer and divides coordinates back down
by `dpr`.

## 4. Pipeline: from HTML to particles

```
HTML element
   │  html2canvas (drawElement)
   ▼
groundTruthCanvas (scratch surface, willReadFrequently)
   │  getImageData → keep pixels with alpha > 0 (samplePixels)
   ▼
pixel list [{x, y, r, g, b, a}]
   │  stride sampling (samplePixelTargets, PARTICLE_STRIDE = 10)
   ▼
targets [{ targetX, targetY, targetColor, targetRadius }]
   │  spawn strategy decides the *starting* position (spawnInRing / spawnOffscreenNearby)
   ▼
Particle[]  ── rendered onto particleCanvas
```

Two canvases are used:

- **`groundTruthCanvas`** — scratch surface. Each text element is rendered here
  one at a time and immediately sampled. Targets for all three elements are
  pre-captured up front (`precaptureElementTargets`) and cached in a
  `Map<Element, targets>`.
- **`particleCanvas`** — the visible surface the particles are drawn on.

`PARTICLE_STRIDE = 10` means only every 10th opaque pixel becomes a particle —
the knob that trades fidelity for particle count.

### Spawn strategies

Higher-order functions returning a `spawn(refX, refY)` closure:

- `spawnInRing` — random point in an annulus around the screen center (the
  initial orbiting cloud).
- `spawnOffscreenNearby` — rejection-samples a point that lands **outside** the
  viewport near a reference point (used so transitioning particles fly in from
  / out to the edges).

## 5. The animation loop

`ParticleAnimator` (`animator.js`) is the heart of the runtime. One animator is
"active" at a time (`activeAnimator` in `main.js`); starting a new one stops the
previous.

```js
draw() {
  clearCanvas(this.rc);
  const allArrived = this.animation({ particles, speed, rc, ...animationArgs });
  renderParticles(this.particles, this.rc);
  if (allArrived) { this.stop(); this.onComplete?.(); return; }
  this.animationId = requestAnimationFrame(this.draw);
}
```

Key characteristics:

- **One animator = one behavior.** The behavior is a single function passed in
  as `animation`. Composition (e.g. "seek *and* fade color") is done by making
  one big function that does several things, not by stacking small ones.
- **Behaviors are `(state) => boolean`.** Returning `true` means "done", which
  stops the loop and fires `onComplete`. This is how the sequence chains
  together (explode's `onComplete` starts the seek animator, etc.).
- **Mutation in place.** Behaviors mutate the shared `particles` array directly.
- **Render is dumb.** `renderParticles` loops every particle and issues
  `beginPath` / `arc` / `fill`. This is the dominant per-frame cost and the
  main performance ceiling.

### The behaviors

| Behavior | What it does | Termination |
| --- | --- | --- |
| `moveParticlesInOrbit` | Swirling cloud: per-particle angular motion + breathing + wobble + twist, driven by `performance.now()`. | Never (`return false`). |
| `explodeParticles` | Gives each particle an outward velocity, applies decay each frame. | When all velocities fall below `stopThreshold`. |
| `moveParticlesTowardsTarget` | Eases each particle toward its target with distance-based accel/decel; optionally lerps color & radius; optionally culls dying off-screen particles. | When all particles are within `arrivalThreshold`. |
| `moveParticlesInCircle` | Simple rigid rotation about center (currently unused in the sequence). | Never. |

## 6. Timing model — frame-count, not time

**This is the core weakness the migration must fix.** Every behavior advances
state by a fixed amount *per frame*, with no reference to elapsed time:

- Movement: `p.x += (dx / distance) * moveDistance` — a per-frame step.
- Decay: `p.explodeVX *= deceleration` (`0.97`/frame) — a per-frame multiply.
- Smoothing/lerp: `p.currentSpeed += (desired - current) * speedSmoothing`,
  `lerp(color, target, colorLerpRate)` — per-frame fractions.

Consequences:

- On a 144 Hz display the animation runs ~2.4× faster than on 60 Hz.
- A dropped frame or a background tab makes motion stutter rather than
  continue smoothly.
- "Speed" constants are unitless and only meaningful relative to an assumed
  frame rate.

Only `moveParticlesInOrbit` reads a clock (`performance.now()`), and even then
the per-particle angular step (`p.angle += speed / p.baseRadius`) is per-frame.

## 7. Transitions

When a nav button is clicked, `transitionToElement(newElement)`:

1. Stops the active animator.
2. `assignTransitionTargets` reconciles the **existing** particle array against
   the **new** target set:
   - Shuffles both index lists, then matches particles ↔ targets pairwise.
   - **Surplus particles** (more particles than targets) are marked `dying`
     and given an off-screen death target.
   - **Surplus targets** (more targets than particles) spawn **new** particles
     off-screen flying in.
3. Cross-fades: real HTML element out, particle canvas in.
4. Starts `transitionAnimator` (a `moveParticlesTowardsTarget` with color/radius
   lerp + off-screen culling enabled).

The cull path (`cullOffscreen`) is what eventually `splice`s dead particles out
of the array, so the array size tracks the active target count over time.

## 8. The orchestration sequence (`main.js`)

`main.js` is both the composition root and the state machine, expressed
imperatively:

```
initializeParticles() ─▶ orbit animator + fade in "click anywhere"
        click/space ─▶ explode animator
   explode.onComplete ─▶ seek-to-text animator
      seek.onComplete ─▶ fadeToHtml (canvas out, HTML in)
        nav button ─▶ transitionToElement(target)  (re-targets + seek)
```

The "state machine" is implicit: it lives in the `onComplete` callbacks and the
module-level `activeAnimator`/`currentElement` variables. Each pre-built
animator (`particlesOrbitAnimator`, `explodeParticlesAnimator`,
`particlesToTextAnimator`, `transitionAnimator`) is a fixed configuration of a
behavior + args.

## 9. Rendering & DOM coupling

- `renderParticles` is the only draw path: immediate-mode Canvas2D, one path per
  particle per frame.
- `utils.js` mixes two unrelated concerns: **canvas clearing** and a large set
  of **DOM fade/visibility helpers** (`fadeIn`, `fadeOut`, `fadeInCanvas`,
  `pulseOpacity`, `showElement`, `hideCanvas`…). The particle visuals and the
  HTML hand-off are tightly interleaved through these helpers.
- `FADE_DURATION_MS` is exported from `main.js` and imported back by `utils.js`
  — a small circular dependency between the composition root and a util module.

## 10. Strengths to preserve

- **Behaviors as pluggable functions** with a clear `(state) => done?` contract.
- **Targets decoupled from motion** — any source of `{x, y, color}` points can
  drive the swarm. (This is exactly the seam the stippling pipeline will use.)
- **Spawn strategies as higher-order functions** — clean, composable.
- **HTML hand-off** keeps the real content accessible; particles are pure
  decoration.

## 11. Weaknesses the migration targets

| Weakness | Impact | Fixed by |
| --- | --- | --- |
| Frame-count timing | Frame-rate-dependent speed; stutter. | Delta-time clock. |
| AoS + monkey-patched fields | Opaque state; cannot upload to GPU. | SoA `ParticleBuffer`. |
| `arc`/`fill` per particle | Hard performance ceiling. | Instanced WebGL rendering. |
| Monolithic behaviors | "Seek+color+radius+cull" is one function with 8 args. | Composable behavior stack. |
| Imperative sequence in `main.js` | Hard to read/extend the flow. | Explicit director/state machine. |
| One-active-animator model | Can't run two behaviors at once. | Behavior stack per frame. |

See [`target-architecture.md`](./target-architecture.md) for the design that
addresses each of these.
