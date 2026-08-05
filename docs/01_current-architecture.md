# Current architecture: Canvas2D particle system

Describes the system as it exists in `client/src/particle-system/`. The `client/src/gl-particle-system/` directory is an empty WebGL stub and is ignored here.

The proposed successor is the [[02_webgpu-architecture|WebGPU particle engine]].

## 1. What it does

A full-screen particle effect on the personal page. Text sections (`biotext`, `projectstext`, `othertext`) are rasterized, sampled into per-pixel targets, and particles morph between them:

```
page load ─▶ capture all 3 text elements ─▶ sample targets
          ─▶ spawn particles in ring ─▶ orbit idle animation
click/space ─▶ explode ─▶ seek to bio text ─▶ fade canvas out, real HTML in
nav button ─▶ reassign targets (+ births/deaths) ─▶ seek ─▶ fade to HTML
```

## 2. Modules

| File | Responsibility |
| --- | --- |
| `main.js` | Orchestration: wires canvases, pre-captures targets, builds the four animators, binds click/keyboard/nav events, owns the `activeAnimator` handoff |
| `canvas.js` | `RenderingContext` (canvas + 2D ctx), DPR-aware full-window resize |
| `sampleElement.js` | Captures a DOM element with `html2canvas-pro`, draws it to the ground-truth canvas, reads pixels back with `getImageData`, returns opaque pixels as `{x, y, r, g, b, a}` |
| `particleSystem.js` | `Particle` class, spawn position generators (`spawnInRing`, `spawnOffscreenNearby`), `samplePixelTargets` (every 10th opaque pixel → target), `renderParticles` |
| `animator.js` | `ParticleAnimator` (RAF loop: clear → run behavior → render → repeat until behavior reports done) and the behavior functions: `moveParticlesTowardsTarget`, `moveParticlesInOrbit`, `moveParticlesInCircle`, `explodeParticles` |
| `transition.js` | `assignTransitionTargets`: random-shuffle matching of existing particles to new targets, surplus particles fly offscreen and die, deficit spawns new ones. `fadeToHtml` swaps canvas for the real element |
| `utils.js` | Fade/show/hide helpers for canvases and elements, opacity pulse |

## 3. Data model

- **AoS**: one `Particle` object per particle, with `x/y`, `targetX/Y`, `radius`, `targetRadius`, `color`, `targetColor`, where colors are `{r,g,b}` objects.
- Behaviors monkey-patch scratch state onto instances at first touch: `currentSpeed` (seek), `explodeVX/VY` (explode), `baseRadius/baseAngle/angle` (orbit), `dying` (transitions).
- Culling uses `Array.splice` inside a reverse loop.

## 4. Frame loop & rendering

- One `ParticleAnimator` is active at a time. Each `draw()` runs the behavior over all particles, then draws each as `ctx.arc()` + `ctx.fill()`, one path per particle per frame.
- No delta time: speeds are per-frame, so motion speed is tied to refresh rate.
- Two full-screen canvases: `groundTruthCanvas` (hidden, capture + readback) and `particleCanvas` (visible).

## 5. Known limits

1. **Draw cost**: per-particle Canvas2D path drawing caps the count, so targets are subsampled with `stride = 10` to stay smooth.
2. **Frame-rate dependence**: no `dt`, so animations run faster on 120 Hz displays.
3. **Hidden state**: behavior scratch fields exist only after first use, so there is no single description of a particle's full state.
4. **O(n) culling** via `splice`.
5. **No resize handling** after initialization. A window resize leaves stale canvas sizes and targets.
6. **Sequential orchestration**: animator chaining is done through `onComplete` callbacks and module-level mutable state in `main.js`.
