# Learning path: what to know to build the WebGPU engine

Companion to the [[02_webgpu-architecture|WebGPU particle engine]] architecture. Assumes no graphics experience. Ordered so each stage unblocks a concrete part of the project. Learn by building the milestones, not by reading exhaustively first.

## 1. The mental model (read first, ~1 evening)

The GPU is a separate machine with its own memory. Your JS/TS never touches particles per frame. It records command lists ("set this pipeline, bind these buffers, run this shader 100k times") and submits them to a queue.

Key consequences that shape everything in this project:

1. **Data lives GPU-side** in buffers (arrays of structs) and textures (2D grids). Moving data CPU↔GPU is slow and explicit, and the architecture avoids it per-frame by design.
2. **Shaders are functions run in massive parallel**, one invocation per particle (compute) or per vertex/pixel (render). No loops over particles in JS.
3. **Everything is declared up front**: buffer sizes, usage flags, pipeline state, bind group layouts. WebGPU validates aggressively and its error messages are genuinely good, so read them.

Resource: webgpufundamentals.org, the "Fundamentals", "Inter-stage variables", "Uniforms", "Storage buffers", and "Compute shaders" articles. This one site covers ~70% of the project's WebGPU needs.

## 2. WebGPU API core (learn by milestone M1–M2)

| Concept | What it is | Where the project uses it |
| --- | --- | --- |
| adapter → device → queue | Handshake to get a GPU handle | `core/device.ts`, capability gate |
| canvas context + `configure()` | Connect a `<canvas>` to the swapchain | `render/renderer.ts` |
| `GPUBuffer` + usage flags | GPU memory; STORAGE, UNIFORM, COPY_SRC/DST | `ParticlePool`, params, stats |
| `queue.writeBuffer` | CPU → GPU upload | assignment upload at transitions |
| `mapAsync` + staging buffer | GPU → CPU readback (async!) | arrival stats |
| bind group (+ layout) | "Which buffers/textures does this shader see" | everywhere |
| render pipeline + render pass | Vertex+fragment shaders, blending config | particle draw |
| compute pipeline + dispatch | Run a compute shader N times | behaviors, JFA, centroids |
| command encoder / submit | Record passes, send to queue | `engine.ts` frame loop |

**Gotcha to internalize early, alignment.** WGSL structs have C-like alignment rules (`vec2f` aligns to 8, `vec4f`/padding to 16). Your TypeScript-side `Float32Array` layout must match byte-for-byte. Get this wrong and particles silently scramble. Learn the rules once (webgpufundamentals "memory layout" article) and centralize the layout in one file (`particle-pool.ts`) so it's defined in exactly one place.

## 3. WGSL, the shader language (alongside M2–M3)

It's a small, Rust-flavored language. You need:

- Types: `f32 u32 i32 vec2f vec4f`, structs, arrays, `let`/`var`
- **Address spaces**: `uniform` (small read-only params), `storage` (big arrays, read or read_write), `private`, `workgroup`
- Builtins: `@builtin(global_invocation_id)` (compute, "which particle am I"), `@builtin(instance_index)` / `@builtin(vertex_index)` (render), `@builtin(position)`
- `@workgroup_size(64)` and dispatch math (`ceil(count / 64)` workgroups), always bounds-check `id >= count`
- **Atomics**: `atomic<u32/i32>` + `atomicAdd` only, no float atomics. The centroid accumulator therefore uses fixed-point (multiply by ~256, add as integer, divide on read). Understand this trick before the Lloyd module.
- Packing: `pack4x8unorm` / `unpack4x8unorm` for the `u32` colors

## 4. Rendering technique for this project (M2)

Only one drawing technique is needed, so learn it well:

- **Instanced quad + SDF circle**: draw 4 vertices × N instances. The vertex shader positions a small quad per particle by reading the particle storage buffer at `instance_index` ("vertex pulling", no vertex buffers at all). The fragment shader computes distance-from-center and fades the edge (`smoothstep`) to get an antialiased circle.
- **Alpha blending**: premultiplied alpha, blend state on the pipeline. One article's worth of theory, and you configure it once.
- Clip space (−1..1) vs pixel coordinates, and devicePixelRatio.

## 5. Compute-shader thinking (M3–M4)

The habit shift from CPU code: one shader invocation per particle, no shared mutable state unless it's atomic or you own the slot you write.

- Embarrassingly parallel passes (behaviors, color lerp): trivial, each thread reads and writes only `particles[id]`.
- **Reductions** (arrived-count stats): many threads → one counter → `atomicAdd`.
- **Scatter with collisions** (centroid accumulation): many pixels → same cell's accumulator → fixed-point atomics.
- Ping-pong: JFA reads texture A, writes texture B, swap, repeat. Same idea as double buffering.

## 6. The algorithms (CPU-side thinking, parallel with M4–M5)

| Algorithm               | What to understand                                                                                            | Used by                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| dt integration & easing | pos += vel·dt; clamp dt; smoothstep/ease curves; exponential smoothing                                        | all behaviors                 |
| Rejection sampling      | Sample points ∝ image darkness: pick random (x,y), keep with probability ρ(x,y)                               | initial stipple points        |
| Voronoi diagram / CVT   | Every pixel "belongs" to nearest seed; centroidal = each seed sits at its cell's center of mass               | stippling theory              |
| **Lloyd relaxation**    | Iterate: compute cells → move seeds to (density-weighted) centroids → repeat; converges to blue-noise spacing | the live relaxation animation |
| **Jump Flooding (JFA)** | Computes Voronoi on a grid in log(n) passes by propagating nearest-seed info at halving jump distances        | GPU Voronoi each tick         |
| Morton (Z-order) codes  | Interleave x/y bits → 1D key that preserves spatial locality; sort both sides, match by rank                  | `matching/morton.ts`          |

Readings: Secord, *Weighted Voronoi Stippling* (2002), which is short, readable, and literally this feature. Rong & Tan, *Jump Flooding in GPU* (2006), which you read for the idea and implement from a tutorial. Red Blob Games for intuition on Voronoi/Morton. Understand Lloyd on paper (it's 3 sentences of math) before touching the GPU version.

## 7. TS/JS plumbing you'll lean on

- `ArrayBuffer`, `Float32Array`/`Uint32Array` views over the same buffer (how you build interleaved structs CPU-side), `DataView` for mixed types
- Bit ops for Morton interleave and rgba8↔u32 packing
- `async/await` discipline: device init, `mapAsync`, image decode (`createImageBitmap`), font readiness before DOM capture
- Vite: importing `.wgsl` as strings (`?raw`), TS config, trivial, just know it exists

## 8. Debugging & profiling (learn at M3, not when desperate)

There is no `console.log` in a shader. Your tools, in order of use:

1. **Validation errors**, WebGPU's messages name the exact buffer/pipeline. Push/pop error scopes in dev builds.
2. **Draw the data**, render any intermediate as color: velocities, journey progress, the JFA texture (cell id → hue). A debug-view toggle in the renderer pays for itself many times over, so build it early.
3. **Readback**, copy a suspect buffer to a staging buffer, `mapAsync`, inspect in the console.
4. **Profiling**, start with the FPS graph in Chrome DevTools performance panel. Use `timestamp-query` for per-pass GPU timing later, only if needed.

Caveat: WGSL compile errors surface async, so wire them to the console on day one (`device.pushErrorScope` / `shaderModule.getCompilationInfo`).

## 9. Suggested milestones

Each one is small, visible, and produces code that survives into the final engine.

| #   | Build                                                                                   | You learn                                                  |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| M1  | Device init + capability gate + canvas cleared to a color                               | §2 handshake, render pass                                  |
| M2  | 10k static circles from a storage buffer, one instanced draw                            | buffers, bind groups, WGSL structs/alignment, SDF quad     |
| M3  | Compute pass moves them (seek to mouse, dt-based) + debug color view                    | compute pipelines, dispatch, ping-pong of ideas, debugging |
| M4  | Orbit/explode/seek behaviors, cohorts via `group`, Morton matching, progress color lerp | full behavior system, CPU matching                         |
| M5  | Density map + rejection sampling: particles gather into a static stippled image         | image pipeline, sampling                                   |
| M6  | JFA + weighted centroids: live Lloyd relaxation on M5's points                          | JFA, atomics/fixed-point, the whole stipple loop           |
| M7  | Director + scenes: text morph flow + image cycle + transitions                          | integration; mostly TS, no new GPU concepts                |

By M3 you have touched every WebGPU concept the project needs. M4–M7 are depth, not breadth.

## 10. Resource shortlist

- webgpufundamentals.org, the primary text, read lazily per milestone
- W3C WGSL spec, as a reference (alignment tables, builtin list), not a read
- webgpu.github.io/webgpu-samples, working code to steal patterns from
- Surma, *WebGPU — All of the cores, none of the canvas*, the best compute-only intro (pre-1.0 API details may differ slightly)
- Secord 2002 (stippling) · Rong & Tan 2006 (JFA) · Red Blob Games (Voronoi/Morton intuition) · Inigo Quilez, *2D distance functions* (SDF circle, you need one paragraph of it)
