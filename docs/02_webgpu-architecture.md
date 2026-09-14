# Architecture: WebGPU particle engine

One engine, one particle pool, powering everything on the page: text morphing (as today) and a real-time Voronoi-stippled image cycle.

This is the proposed successor to the [[01_current-architecture|Canvas2D system]].

## 1. Decisions (confirmed)

| Decision               | Choice                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fallback               | WebGPU-only. If `navigator.gpu` is unavailable, skip particles and show the static HTML page                  |
| Scale                  | Designed around 20k–100k particles (fixed-capacity pool, size chosen at init)                                 |
| Language               | TypeScript                                                                                                    |
| Color morph            | **Progress-based lerp**: color is a function of journey progress, so a particle lands exactly the right color |
| Matching               | **Spatially coherent** by default (Morton-order rank matching), pluggable strategy                            |
| Image transition style | Pluggable per cycle step: direct retarget or an interlude behavior (e.g. explode), both supported             |

## 2. CPU / GPU split

Per-frame, per-particle work runs on the GPU. Infrequent, DOM-bound, or inherently sequential work stays on the CPU.

| CPU (infrequent / DOM)                                                      | GPU (every frame)                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| Director state machine, input events                                        | Behavior simulation (seek, orbit, explode, …)      |
| DOM capture (`html2canvas`) + pixel sampling                                | Progress-based color/radius lerp                   |
| Image decode; initial stipple sampling (rejection sampling, once per image) | Voronoi (JFA) + weighted centroids → Lloyd targets |
| Particle↔target matching (Morton sort, once per transition)                 | Rendering (one instanced draw)                     |
| Pipeline/bind-group construction                                            | Arrival stats reduction                            |

## 3. Layers

```
┌───────────────────────────────────────────────────────────────┐
│ Director            scene state machine (CPU)                 │
│   Scenes: IntroOrbit · TextMorph · StippleCycle · …           │
├───────────────────────────────────────────────────────────────┤
│ TargetProviders     HtmlProvider · StippleProvider   (CPU)    │
│   → TargetSet { pos, color, radius : typed arrays }           │
├───────────────────────────────────────────────────────────────┤
│ Matcher             Morton | Random | …              (CPU)    │
│   → per-particle assignment written to GPU buffers            │
├───────────────────────────────────────────────────────────────┤
│ Engine              clock (dt) · frame graph · stats readback │
│   ├─ ParticlePool   GPU storage buffers (single source of     │
│   │                 truth for particle state)                 │
│   ├─ Behaviors      WGSL compute passes, composable           │
│   ├─ LloydModule    JFA + centroid compute passes             │
│   └─ Renderer       instanced SDF circles, one draw call      │
└───────────────────────────────────────────────────────────────┘
```

Contracts between layers are plain TypeScript interfaces + fixed WGSL struct layouts. Everything above the Engine only ever produces TargetSets and scene commands, and everything below only consumes buffers.

## Subsystems

Ordered walk through the engine, bottom of the pool to top of the scene graph:

1. [[01_particle-pool|Particle pool]], the GPU storage buffers that are the single source of truth for particle state.
2. [[02_behaviors|Behaviors]], composable WGSL compute passes that move particles (seek, orbit, explode, relax).
3. [[03_stipple-pipeline|Stipple pipeline]], real-time Voronoi + Lloyd relaxation that turns images into point density.
4. [[04_rendering|Rendering]], one instanced draw of SDF circles.
5. [[05_director-scenes|Director & scenes]], the CPU state machine that sequences page flow.

## Reference

- [[zz_extension-points|Extension points]], what to touch to add a behavior, target source, matcher, transition, or scene.
- [[zy_module-layout|Module layout]], the file and directory plan under `client/src/engine/`.
- [[zx_deferred-tunables|Deferred tunables]], knobs left for later, not architectural.
