# Target Architecture — WebGL2 Particle Engine + Stipple Pipeline

> Companion to [`current-architecture.md`](./current-architecture.md). This
> document describes where the system is going and **why** each decision is
> made. It folds the design rationale into the description rather than keeping a
> separate "decisions" log.

## 0. Goals, restated

1. **WebGL rendering** — lift the per-frame draw ceiling (today: one
   `arc`/`fill` per particle).
2. **Frame-rate-independent motion** via delta-time integration.
3. **A stippling pipeline** (Voronoi stippling + Lloyd relaxation) as a way to
   turn images into particle targets.
4. **Extensible, modular, editable** above all — the prototype's logic is *not*
   to be ported 1:1.

A guiding principle throughout: **the bottleneck is rendering and timing, not
the simulation math.** Particle counts here are sampled glyphs/stipples —
thousands to low tens of thousands — so the highest-leverage moves are
*instanced GPU rendering* and a *delta-time clock*, not rewriting the
simulation as shaders. The architecture keeps a clean seam so simulation *can*
move to the GPU later, but does not force it now.

## 1. The big decision: CPU simulation, GPU rendering

There are two families of WebGL particle systems:

| Approach | Sim runs on | Pros | Cons |
| --- | --- | --- | --- |
| **A. CPU sim, GPU render** *(chosen)* | JS, over typed arrays; positions uploaded to a VBO each frame, drawn instanced | All CPU-side logic (matching, spawning, culling, Lloyd centroids) stays trivial; easy to debug; fully flexible behaviors | Per-frame buffer upload; simulation is single-threaded |
| **B. GPGPU sim** (transform feedback / ping-pong FBO) | Shaders; state lives in buffers/textures | Scales to millions; no upload | Matching/spawn/cull/relaxation must be reformulated as GPU passes or need readback; much harder to edit |

**We choose A**, because it preserves everything the prototype does well (the
extensible behavior model, index-based target matching, off-screen culling) and
removes the *actual* ceiling (Canvas2D draw). Approach B is kept available as a
future optimization behind the same `Renderer`/`Behavior` seams (see §8).

**Target WebGL2, not WebGL1.** It is universal in 2026 and gives us, for free:
instanced drawing without an extension, `gl_VertexID`/`gl_InstanceID`, transform
feedback (the upgrade path to approach B), integer textures and MRT (exactly
what the stipple Jump-Flood pass wants). There is no reason to pay the WebGL1
extension tax.

## 2. Layered architecture

```
┌────────────────────────────────────────────────────────────┐
│ Director / Scenes        explicit state machine (was main.js)│
├────────────────────────────────────────────────────────────┤
│ TargetProviders          HTML · Image · Text · Stipple       │  ← produces target point sets
├────────────────────────────────────────────────────────────┤
│ Engine (RAF + Clock)     owns buffer, behavior stack, renderer│
│   ├─ Behaviors           Seek · Orbit · Explode · LerpColor … │  ← composable, dt-aware
│   └─ ParticleBuffer      SoA typed arrays (the shared state)  │
├────────────────────────────────────────────────────────────┤
│ Renderer (interface)     Canvas2DRenderer | WebGLRenderer     │  ← swappable backend
└────────────────────────────────────────────────────────────┘
```

Each layer talks to the next only through a narrow contract. The two contracts
that matter most are **`ParticleBuffer`** (shared state) and **`Renderer`**
(backend). Get those right and everything else is swappable.

A diagram of this layering and the per-frame data flow lives in
[`target-architecture.excalidraw`](./target-architecture.excalidraw).

## 3. Data model: Struct-of-Arrays `ParticleBuffer`

Replace the `Particle` class (and its monkey-patched fields) with one
**struct-of-arrays (SoA)** container holding parallel typed arrays:

```js
class ParticleBuffer {
  // hot, uploaded to the GPU each frame
  posX:  Float32Array   posY:  Float32Array
  velX:  Float32Array   velY:  Float32Array
  radius: Float32Array
  rgba:  Uint8Array      // 4 bytes/particle, or Float32 if you prefer

  // targets / desired state (CPU-side only)
  targetX, targetY, targetRadius, targetRGBA

  // scratch previously monkey-patched onto instances
  speed, baseRadius, baseAngle, angle   // allocated once, for all particles

  count, capacity
  append(...) ; swapRemove(i)
}
```

Why this shape:

- **GPU upload** wants contiguous, homogeneous arrays. SoA *is* the VBO layout;
  uploading is a `bufferSubData` of a sub-range, not a per-object copy.
- **No hidden state.** Every field a behavior might touch is declared up front
  and allocated for the whole pool. (Today's `currentSpeed`, `explodeVX`, etc.
  become named arrays.)
- **`swapRemove`** replaces `Array.splice` for culling — O(1), and keeps the
  live range `[0, count)` dense so the upload is one contiguous slice.
- **`append`** with a pre-grown `capacity` replaces `particles.push` for
  spawning, avoiding reallocation churn during transitions.

The transition's shuffle-and-match logic ports directly: it operates on
indices, which SoA supports as well as AoS did.

**Coordinate space:** simulate in CSS pixels (as today). The WebGL vertex shader
receives a `uResolution` uniform and maps pixel space → clip space, so the
simulation never needs to know about clip coordinates or DPR.

## 4. Timing: a delta-time `Clock`

A single `Clock` produces `dt` (seconds) each frame; the engine passes it to
every behavior. Behaviors integrate **rates**, not per-frame steps.

Conversions required (these are the subtle part of the migration):

| Today (per frame) | Target (per second, dt-aware) |
| --- | --- |
| `x += vx` | `x += vx * dt` |
| `v *= 0.97` | `v *= Math.exp(-k * dt)` |
| `lerp(a, b, 0.06)` | `lerp(a, b, 1 - Math.exp(-k * dt))` |
| `angle += speed / r` | `angle += (speed / r) * dt` |

Rules:

- **Clamp `dt`** (e.g. `min(dt, 1/20)`) so a background-tab stall or GC pause
  cannot teleport particles across the screen.
- Exponential forms (`exp(-k·dt)`) are used for any decay/smoothing so the
  *result* is identical regardless of frame rate, not merely "scaled."
- Optional: a fixed-timestep accumulator if determinism is ever needed; clamped
  semi-fixed `dt` is enough for visuals and is the default.

Speed constants now carry real units (px/s, 1/s) and are portable across
displays.

## 5. Behaviors: a composable stack

The prototype's "one animator = one big function" becomes a **stack of small
behaviors** the engine runs in order each frame:

```js
// interface
interface Behavior {
  update(buffer, dt, ctx): void;   // mutate the SoA buffer
  isComplete?(): boolean;          // optional; for one-shot behaviors
}
```

`moveParticlesTowardsTarget` (which today does seek + color-lerp + radius-lerp +
cull in one function with eight args) decomposes into independent units:

```
SeekTarget · LerpColor · LerpRadius · CullOffscreen
Orbit · Explode · (future) Noise, Gravity, Flock …
```

Benefits:

- **Editable:** "form text with a color fade and size pop" is a *list*
  `[SeekTarget, LerpColor, LerpRadius]`, not a function signature. Reorder, add,
  or drop a line.
- **Reusable:** `LerpColor` works under orbit, seek, or explode alike.
- **Concurrent:** multiple behaviors run the same frame — solving the
  prototype's "only one active animator" limitation.

Completion is aggregated by the engine (e.g. "all one-shot behaviors report
complete") and reported to the Director, replacing the `onComplete` callback
chain.

## 6. Renderer: an interface with two backends

```js
interface Renderer {
  resize(width, height, dpr): void;
  draw(buffer): void;   // reads the SoA arrays, draws the live range
}
```

- **`Canvas2DRenderer`** — essentially today's `renderParticles`. Kept as a
  reference implementation and a fallback for WebGL-less contexts. It is also
  the **parity oracle** during migration: the WebGL output should match it.
- **`WebGLRenderer`** — WebGL2, **instanced quads**:
  - One unit quad in a static VBO; one instance per particle.
  - Per-instance attributes (`posX/Y`, `radius`, `rgba`) come from a dynamic VBO
    updated via `bufferSubData` from the SoA arrays each frame — the single
    bridge between CPU sim and GPU draw.
  - The fragment shader draws a soft, anti-aliased disc
    (`smoothstep` on `length(uv)`), premultiplied-alpha blended. Swapping in
    additive blending or textured sprites is a shader-level change only.

Because both backends consume the same `ParticleBuffer`, switching is a
one-line change and the two can be A/B'd.

## 7. TargetProviders: where points come from

Decouple *what the swarm forms* from *how it moves*. A provider yields a target
set; behaviors animate toward it.

```js
interface TargetProvider {
  getTargets(): { x, y, color, radius }[];   // may be async
}
```

Implementations: `HtmlElementProvider` (today's html2canvas path),
`ImageProvider`, `TextProvider`, and — crucially — **`StippleProvider`** (§9).
The stippler is *just another provider*: image → stipple points → targets →
existing `SeekTarget` animates the swarm into the image. Everything downstream
is reused unchanged.

## 8. Director / Scenes: an explicit state machine

The implicit machine in `main.js` (module-level `activeAnimator` +
`onComplete` callbacks) becomes an explicit one. A **Scene** bundles *(active
TargetProvider + behavior stack)*; the **Director** owns transitions between
scenes and listens for engine completion / DOM events.

```
Intro(orbit)  ──click──▶  Explode  ──done──▶  FormText(seek+lerp)  ──done──▶  HandOff(HTML)
      ▲                                                                            │
      └──────────────────────────── nav button (re-target) ◀──────────────────────┘
```

This makes the flow readable and extensible: adding a "stipple an image" scene
is a new entry in the machine, not new tangled callbacks. The DOM hand-off and
fade helpers (today crammed into `utils.js`) move behind the Director so
particle concerns and DOM concerns stop interleaving.

## 9. The stippling pipeline

A `StippleProvider` turns an image into a set of well-distributed points whose
density follows image darkness — the classic **weighted Voronoi stippling**
(Secord 2002): repeatedly build the Voronoi diagram of the points and move each
point to the **density-weighted centroid** of its cell (**Lloyd relaxation**).

Two implementation tiers behind the same provider interface:

**Tier 1 — CPU, in a Web Worker (ship this first).**
- `d3-delaunay` for Voronoi; centroids weighted by sampled luminance.
- Iterate ~10–20 relaxation passes; emit points.
- Runs off the main thread, is easy to verify, and is independently useful.

**Tier 2 — GPU (the "cool" version, drop-in later).**
- **Jump Flood Algorithm (JFA)** computes the Voronoi diagram into a texture in
  `O(log n)` passes (each pixel ends up tagged with its nearest site id — this
  is why we wanted WebGL2 integer textures).
- A reduction pass accumulates density-weighted centroids per cell; ping-pong to
  relax.
- Fully on-GPU, scales, and animates live.

Either tier outputs the same `{x, y, color, radius}[]`, so the swarm,
behaviors, and renderer never know which produced it. Starting with Tier 1 keeps
the feature shippable; Tier 2 is a pure upgrade behind the seam.

## 10. Migration order (always a working build)

Each step is independently shippable and checkable against the prototype.

1. **Restructure, don't port.** Introduce `ParticleBuffer` (SoA), `Behavior`,
   `Renderer` interfaces — but keep `Canvas2DRenderer` driving. Verify visual
   parity with the prototype. *No WebGL yet.*
2. **Delta-time.** Add the `Clock`, convert every behavior to dt (table in §4).
   Verify motion is identical at 60 Hz and under CPU throttling.
3. **WebGL.** Add `WebGLRenderer` (instanced quads), swap it behind the
   `Renderer` interface. Canvas2D remains the fallback / parity oracle.
4. **Director.** Lift the `main.js` sequence into an explicit Scene machine.
5. **Stipple, Tier 1.** Add `StippleProvider` (Voronoi + Lloyd in a worker).
6. *(Optional)* **Tier 2 / GPGPU.** JFA stippling; transform-feedback simulation
   if profiling ever demands it — both fit behind existing seams.

## 11. How each weakness is resolved

| Prototype weakness | Resolution |
| --- | --- |
| Frame-count timing | Delta-time `Clock`; exponential decay/smoothing (§4). |
| AoS + monkey-patched fields | SoA `ParticleBuffer` with all fields declared (§3). |
| `arc`/`fill` per particle | Instanced WebGL2 quads, one upload/frame (§6). |
| Monolithic behaviors | Composable `Behavior` stack (§5). |
| Imperative `main.js` sequence | Explicit Director / Scene machine (§8). |
| One active animator | Behavior stack runs many behaviors per frame (§5). |
| Targets ⇄ motion coupling | Already a strength; formalized as `TargetProvider` (§7). |
| No image rendering path | `StippleProvider` reuses the whole pipeline (§9). |

## 12. Proposed module layout

```
client/src/gl-particle-system/
  engine/
    ParticleBuffer.js     # SoA state + append/swapRemove
    Clock.js              # dt, clamping
    Engine.js             # RAF loop: clock → behaviors → renderer
  behaviors/
    SeekTarget.js  Orbit.js  Explode.js  LerpColor.js  LerpRadius.js  CullOffscreen.js
  render/
    Renderer.js           # interface/JSDoc contract
    Canvas2DRenderer.js
    WebGLRenderer.js      # instanced quads
    shaders/particle.vert  particle.frag
  targets/
    TargetProvider.js
    HtmlElementProvider.js  ImageProvider.js  StippleProvider.js
    stipple/
      voronoiLloyd.worker.js   # Tier 1
      jfa/ …                    # Tier 2 (later)
  scenes/
    Director.js  scenes.js
  main.js                 # thin composition root
```

The existing `particle-system/` directory stays untouched as a reference until
the new engine reaches parity, then is removed.
