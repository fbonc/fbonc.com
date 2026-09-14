# Start here: WebGPU particle engine

This is the minimum working knowledge needed to begin the WebGPU rewrite. Read it once, build the first frame, and use the linked references only when the work in front of you requires them.

The intended engine is described in [[02_webgpu-architecture|the architecture overview]]. Its planned files are in [[zy_module-layout|the module layout]]. The existing Canvas2D implementation is documented in [[01_current-architecture|the current architecture]].

## What exists now

- `client/src/particle-system/` is the working Canvas2D system and the current page entry point.
- `client/src/webgpu-particle-system/main.js` is empty.
- `client/src/engine/` does not exist yet. The architecture expects the production rewrite to live there and use TypeScript.
- The new engine should be developed behind a separate page or entry point until it can reproduce the existing flow. This keeps the current site usable while the engine grows.

## Get running

From the repository root:

```sh
cd client
npm install
npm run dev
```

Open the local URL Vite prints. The existing Canvas2D page should run before you change anything.

For the rewrite, add `client/webgpu.html` as a temporary development page:

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WebGPU particles</title>
<style>
  html, body, canvas { width: 100%; height: 100%; margin: 0; display: block; }
  body { background: #111; }
</style>
<canvas id="webgpu"></canvas>
<script type="module" src="/src/engine/main.ts"></script>
```

Vite can transpile `.ts` files without extra setup. Before relying on type checking, add TypeScript and WebGPU's type declarations:

```sh
npm install --save-dev typescript @webgpu/types
```

Then add `client/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["@webgpu/types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Add `"check": "tsc --noEmit"` to the scripts in `client/package.json`. Vite transpiles TypeScript but does not type-check it, so run `npm run check` alongside `npm run build` before committing.

Create `client/src/engine/main.ts` with the smallest complete WebGPU program:

```ts
const canvas = document.querySelector<HTMLCanvasElement>('#webgpu');
if (!canvas || !navigator.gpu) throw new Error('WebGPU is unavailable');

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter');

const device = await adapter.requestDevice();
const context = canvas.getContext('webgpu');
if (!context) throw new Error('Could not create WebGPU canvas context');

const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'premultiplied' });

device.addEventListener('uncapturederror', (event) => {
  console.error(event.error.message);
});
device.lost.then((info) => console.error('WebGPU device lost:', info.message));

new ResizeObserver(([entry]) => {
  const size = entry.contentBoxSize[0];
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.floor(size.inlineSize * dpr));
  canvas.height = Math.max(1, Math.floor(size.blockSize * dpr));
}).observe(canvas);

function frame() {
  const encoder = device.createCommandEncoder({ label: 'frame encoder' });
  const pass = encoder.beginRenderPass({
    label: 'clear pass',
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.03, g: 0.03, b: 0.05, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

Visit `/webgpu.html`. A dark canvas that stays sharp while resizing is the first checkpoint. If this does not work, do not build the particle abstractions yet; fix device creation, canvas configuration, or sizing first.

## The mental model

The CPU and GPU are separate machines. TypeScript runs on the CPU. WGSL shaders run many copies of the same function on the GPU. GPU memory is explicit, and CPU/GPU transfers are comparatively expensive.

For this engine:

- The CPU handles DOM capture, scene decisions, target generation, Morton sorting, and infrequent uploads.
- The GPU owns particle state, advances every particle, computes stippling passes, and renders the result.
- JavaScript never loops over particles each frame. It uploads a small parameter block, records passes, and submits them.
- Particle data stays in GPU buffers. Read back small summaries such as an arrived count, never the whole pool.
- Pipelines, buffers, textures, layouts, and bind groups are created during initialization. A frame creates only its encoder and passes.

GPU work is asynchronous. `queue.submit()` queues commands; it does not wait for them to finish. Awaiting GPU results inside the frame loop destroys CPU/GPU overlap.

## The small WebGPU vocabulary

| Object | Meaning in this engine |
| --- | --- |
| `GPUAdapter` | Available hardware and capabilities |
| `GPUDevice` | Creates GPU resources and pipelines |
| `device.queue` | Receives commands and CPU-to-GPU writes |
| `GPUBuffer` | Untyped bytes for particles, targets, params, and stats |
| Texture | A 2D grid for images, density, and Voronoi state |
| Bind group layout | Contract describing the resources a shader expects |
| Bind group | Actual resources satisfying that contract |
| Pipeline | Compiled shader stages plus fixed configuration |
| Command encoder | Records ordered compute, render, copy, and clear operations |
| Compute pass | Runs general parallel work |
| Render pass | Draws into the canvas or another texture |

Usage flags are permanent permissions. A buffer uploaded with `writeBuffer` needs `COPY_DST`; particle state needs `STORAGE`; a buffer copied out for readback needs `COPY_SRC`. The staging buffer used by JavaScript needs `MAP_READ | COPY_DST`. Labels cost nothing and make validation errors useful.

Use uniforms for one small set of values shared by all invocations: resolution, time, `dt`, counts, and mode flags. Use storage buffers for large arrays such as particles and targets.

`layout: 'auto'` is convenient for the first renderer and compute pass. Automatic layouts belong to one pipeline, so move to explicit bind group layouts when several behavior pipelines need to share the same resource contract.

## WGSL you need

WGSL is strict and small. The common types are `f32`, `u32`, `i32`, `vec2f`, and `vec4f`. It does not implicitly mix numeric types, so write conversions such as `f32(index)`.

The address spaces that matter are:

```wgsl
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> targets: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
var<workgroup> partial: array<u32, 64>;
```

- `uniform`: small, read-only parameters shared by every invocation.
- `storage`: large arrays, either read-only or read/write.
- `workgroup`: temporary memory shared within one compute workgroup.
- Function locals and module-level `private` values belong to one invocation.

The entry-point builtins used here are:

- `vertex_index`: which corner of a particle quad is being drawn.
- `instance_index`: which particle is being drawn.
- `global_invocation_id`: which particle or pixel a compute invocation owns.
- `local_invocation_index`: the position inside a workgroup, used for shared reductions.
- `position`: clip-space output from a vertex shader and pixel coordinates in a fragment shader.

Use `@workgroup_size(64)` for one-dimensional particle work and `@workgroup_size(8, 8)` for grids. Dispatch counts workgroups, so round up and guard the extra invocations:

```ts
compute.dispatchWorkgroups(Math.ceil(count / 64));
```

```wgsl
let i = gid.x;
if (i >= params.count) { return; }
```

If a shader uses `workgroupBarrier()`, every invocation in the workgroup must reach every barrier. In that case, branch around out-of-range work instead of returning early.

## Memory layout is a contract

A GPU buffer is only bytes. TypeScript writes those bytes and WGSL interprets them; WebGPU cannot tell whether the two layouts agree. A mismatch often renders plausible garbage with no error.

The rules worth memorizing are:

| Type | Alignment | Size |
| --- | ---: | ---: |
| `f32`, `u32`, `i32` | 4 | 4 |
| `vec2f` | 8 | 8 |
| `vec3f` | 16 | 12 |
| `vec4f` | 16 | 16 |

Each field begins at the next multiple of its alignment. A struct's alignment is its largest field alignment, and its total size is rounded up to that alignment. Array elements use the rounded struct size as their stride.

Avoid `vec3` in CPU-visible structs. Order fields deliberately, aim for a stride divisible by 16, and store RGBA in a `u32` with `pack4x8unorm` and `unpack4x8unorm` when possible. Use overlapping views when a buffer mixes floats and integers:

```ts
const bytes = new ArrayBuffer(count * STRIDE_BYTES);
const f32 = new Float32Array(bytes);
const u32 = new Uint32Array(bytes);
```

Keep byte offsets and stride in one canonical TypeScript layout definition, and mirror that exact layout in WGSL. Recalculate it whenever the struct changes.

The planned particle layout is in [[01_particle-pool|Particle pool]]. Establish its final byte offsets before implementing behaviors; every later pass depends on it.

## One frame of the engine

The normal frame order is:

1. Compute elapsed seconds and clamp `dt`, usually to `1 / 30`, so returning to a background tab cannot launch particles away.
2. Advance the CPU scene state and collect input.
3. Upload one small uniform block with `queue.writeBuffer`.
4. Create one command encoder.
5. Clear per-frame atomic accumulators.
6. Record stipple passes when active.
7. Record the particle behavior compute pass.
8. Record the particle render pass.
9. Optionally copy a small stats buffer into a free readback staging buffer.
10. Submit once and request the next animation frame.

Pass order on one encoder supplies the needed GPU synchronization. A compute pass that writes particles followed by a render pass that reads them is valid without a manual barrier.

Express motion per second:

```ts
const dt = Math.min((now - previous) / 1000, 1 / 30);
```

```wgsl
p.vel += acceleration * dt;
p.pos += p.vel * dt;
let smoothing = 1.0 - exp(-rate * dt);
p.pos = mix(p.pos, target, smoothing);
```

## Rendering the particles

Draw every particle in one call: `draw(4, capacity)`. The four vertices form a `triangle-strip` quad, and the instance index selects the particle. The vertex shader reads particle state directly from its storage buffer; this is vertex pulling, and it lets compute and render share the same data without copying it.

Keep simulation positions in physical pixels. Convert once at the end of the vertex shader:

```wgsl
fn toClip(pixel: vec2f, resolution: vec2f) -> vec4f {
  return vec4f(
     pixel.x / resolution.x * 2.0 - 1.0,
    -(pixel.y / resolution.y * 2.0 - 1.0),
    0.0,
    1.0,
  );
}
```

The vertex shader also sends each quad corner's local coordinate, from `-1` to `1`, to the fragment shader. The fragment shader turns the square into a soft circle:

```wgsl
let d = length(local);
let width = 1.0 / max(radius, 1.0);
let coverage = 1.0 - smoothstep(1.0 - width, 1.0, d);
```

Use premultiplied alpha consistently. Return `vec4f(rgb * alpha, alpha)` and configure source factor `one`, destination factor `one-minus-src-alpha`. A dark fringe around circles usually means the shader output and blend state use different alpha conventions.

Canvas width and height are physical pixels; CSS dimensions and pointer events use CSS pixels. Multiply CSS-space input by the clamped DPR. Fragment work scales with covered pixel area, so large radii and high DPR usually hurt sooner than particle count.

## Compute rules and parallel patterns

The default ownership rule is: invocation `i` writes only slot `i`. This covers movement, easing, color interpolation, and most particle work.

The exceptions are four reusable patterns:

| Pattern | Use here | Rule |
| --- | --- | --- |
| Map | Move or update every particle | Each invocation owns one output slot |
| Reduction | Count arrived particles | Combine locally, then use an atomic counter if needed |
| Scatter | Accumulate pixels into Voronoi cells | Colliding writes require atomics |
| Ping-pong | Jump flooding over a grid | Read A/write B, then swap; never update neighbors in place |

WGSL atomics support only `u32` and `i32`. For floating-point sums, normalize values, multiply by a chosen scale, round to integers, and use `atomicAdd`. Prove the worst-case sum stays below the integer limit; overflow wraps silently. Clear accumulators before each use.

There is no synchronization between workgroups. End the pass and start another when every invocation must see all previous writes.

## Textures and images

Use textures for two-dimensional data and neighborhood access. Relevant formats are `rgba8unorm` for color, `r32float` for density, and unsigned integer formats for seed IDs or coordinates.

- Upload decoded images with `createImageBitmap` and `queue.copyExternalImageToTexture`.
- In compute, use `textureLoad` with integer pixel coordinates.
- Write per-pixel results with a storage texture and `textureStore`.
- A storage texture's WGSL format must exactly match the created texture.
- Use separate source and destination textures for iterative work. Read/write storage textures require newer optional support and still do not make unsynchronized neighbor updates safe.
- Use render attachments when rasterization or blending is useful, such as splatting seeds; use storage textures for one computed value per cell.

Choose one place to flip image Y coordinates and keep it consistent. Be deliberate about `rgba8unorm` versus `rgba8unorm-srgb`; color-space mismatches look subtly wrong rather than failing.

## The project-specific algorithms

You can defer this section until static particles and compute movement work.

### Image density and initial points

Convert RGB to luminance with `0.2126r + 0.7152g + 0.0722b`, then make dark areas dense with `density = pow(1 - luminance, gamma)`. A small positive density floor prevents zero-weight Voronoi cells.

Rejection sampling runs on the CPU once per image: propose a uniform point and accept it when a uniform random number is below `density / maxDensity`. This gives the right distribution quickly enough, but the points remain clumpy.

### Jump flooding

A Voronoi diagram assigns each grid pixel to its nearest seed. Brute force compares every pixel with every seed. Jump Flooding approximates the same answer in logarithmic passes:

1. Splat seed IDs or coordinates into a texture.
2. For jump sizes from half the grid dimension down to `1`, inspect the 3x3 neighborhood at that spacing and keep the nearest valid seed.
3. Ping-pong source and destination textures each pass.
4. Optionally repeat the final size-1 pass to reduce boundary errors.

Use nearest/integer reads for IDs. Track explicitly which ping-pong texture holds the final result.

### Lloyd relaxation

Lloyd relaxation turns the clumpy random samples into stippling:

1. Compute the Voronoi ownership texture with JFA.
2. For every pixel, atomically add `density * x`, `density * y`, and `density` to its cell.
3. For every seed, divide the weighted sums to obtain its centroid.
4. Move the seed partway toward the centroid and repeat.

Use fixed-point atomics, clear accumulators every iteration, and guard zero-weight cells before dividing. Moving partway to the centroid is slower mathematically but makes the convergence itself a useful animation.

### Morton matching

When changing target sets, random assignment makes paths cross chaotically. For coherent motion, quantize current positions and targets to 16-bit coordinates, compute Morton codes by interleaving their x/y bits, sort both lists, and pair equal ranks. This is `O(n log n)` on the CPU and runs only at transitions.

Morton order can create seams at large quadrant boundaries. Implement it first; consider Hilbert order only if the seam is visible. Angle, x-position, or distance sorts are also useful deliberate transition styles.

## Build in this order

Each step should stay small enough that a failure has only a few possible causes.

1. **First frame:** add the isolated page and clear a DPR-aware canvas. Done when it resizes correctly and reports validation/device errors.
2. **Static particle renderer:** define the final particle stride, upload 10k-100k particles once, and draw four vertices per instance. Done when soft circles render in one draw call.
3. **Compute movement:** add a compute pipeline that seeks toward a target or pointer using clamped `dt`. Record compute then render on one encoder. Done when the CPU never edits particle positions.
4. **Particle pool and behaviors:** move the demo into `core/`, `render/`, and `behaviors/`; add group-selected seek, orbit, and explode behavior plus progress-based color/radius interpolation. Done when simultaneous cohorts can run different behaviors.
5. **Targets and matching:** capture DOM targets, define `TargetSet`, implement Morton rank matching, and upload assignments only at transitions. Done when the current text flow can morph coherently.
6. **Image gather:** turn an image into a density map and rejection-sample initial targets. Done when particles form a recognizable static stipple without relaxation.
7. **Live relaxation:** implement seed splat, JFA ping-pong, fixed-point centroid accumulation, and centroid updates. Done when clumps visibly settle into an even weighted distribution.
8. **Director and integration:** reproduce intro, text navigation, and image-cycle states; switch the real page entry point only after the fallback and core flow work. Done when the Canvas2D system is no longer needed.

The first three steps touch almost every WebGPU concept needed by the project. Do them before designing all engine interfaces. Extract stable boundaries from working code, using the architecture notes as the target shape.

## Debug in this order

1. Read validation errors completely. Label every resource and install an `uncapturederror` handler.
2. Call `shaderModule.getCompilationInfo()` during development; shader compilation errors do not come through error scopes.
3. Draw intermediate data as color: group, velocity, progress, cell ID, or density. This is the shader equivalent of logging.
4. For exact numbers, copy a small debug or stats buffer to a `MAP_READ` staging buffer and inspect it.
5. Profile only after the output is correct. Halve resolution to test fragment cost; halve particle count to test compute/vertex cost.

Production readback must be asynchronous. Keep a few staging buffers, copy into any free one, consume the mapped result a frame or two later, and skip a readback when all slots are busy. Always copy a mapped range with `.slice()` before unmapping it.

Common causes of trouble:

- Scrambled fields: CPU/WGSL stride or offset mismatch.
- Blank output: unreported WGSL compilation error, wrong canvas target format, or missing pass submission.
- Upside-down output: mixed pixel, clip-space, and texture Y conventions.
- Particles explode after tab switching: unclamped `dt`.
- High-DPR slowdown: too many fragment pixels; cap DPR.
- Dark particle edges: premultiplied-alpha mismatch.
- Results change between runs: concurrent non-atomic writes.
- JFA flicker: reading and writing the same texture or selecting the wrong final ping-pong view.
- Lloyd seeds vanish: zero-weight division or fixed-point overflow.
- Statistics tank frame rate: mapping or awaiting readback in the frame loop.

## References when you need more

- [WebGPU Fundamentals](https://webgpufundamentals.org/) for API explanations and working examples.
- [WebGPU samples](https://webgpu.github.io/webgpu-samples/) for known-good pipeline patterns.
- [MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) for method and descriptor lookup.
- [WGSL specification](https://www.w3.org/TR/WGSL/) for types, builtins, and alignment rules.
- [Weighted Voronoi Stippling](https://www.cs.ubc.ca/labs/imager/tr/2002/secord2002b/secord.2002b.pdf) for the stippling pipeline.
- [Jump Flooding in GPU](https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf) for JFA and its error behavior.
- [Inigo Quilez's 2D distance functions](https://iquilezles.org/articles/distfunctions2d/) for SDF shapes.
- [Bit Twiddling Hacks: interleaving bits](https://graphics.stanford.edu/~seander/bithacks.html#InterleaveBMN) for Morton codes.
