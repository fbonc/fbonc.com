# Parallel patterns

Per particle work, where every invocation reads and writes only its own slot, is the easy case and covers most of a particle engine. The rest of it needs invocations to combine their results, and that is where parallel programming actually begins.

There are four shapes worth knowing, and between them they cover everything this project needs.

## The ownership rule

Everything here is a way of relaxing one rule, so state it clearly first.

Invocations execute in no defined order, with no guarantee that any two are running at the same time or at different times, and there is no way to make one wait for another except within a workgroup. If two invocations write to the same memory location without atomics, the result is undefined. Not the first write, not the last, not an average, but genuinely undefined, and it will differ between machines and between runs.

The default discipline is therefore that each invocation writes only to the slot it owns. Every pattern below is a specific, sanctioned way to break that discipline.

## Map

The trivial case, and the one to prefer whenever it applies. Each invocation reads its own input, computes, and writes its own output.

Integration, damping, colour interpolation, and progress updates are all maps. They need no coordination, they scale perfectly, and they are the bulk of the per frame work. If you find yourself reaching for something more complex, check first whether restructuring the data turns the problem back into a map, because it very often does.

## Reduction

Many values in, one value out. Counting how many particles have reached their target is a reduction, and so is summing anything.

The direct approach is [[atomics|atomics]]. An atomic operation performs a read, a modification, and a write as a single indivisible step, so concurrent updates cannot interleave.

```wgsl
struct Stats {
  arrived: atomic<u32>,
}

@group(0) @binding(2) var<storage, read_write> stats: Stats;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) { return; }

  if (distance(particles[i].pos, target) < 2.0) {
    atomicAdd(&stats.arrived, 1u);
  }
}
```

WGSL provides `atomicLoad`, `atomicStore`, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicExchange` and `atomicCompareExchangeWeak`. They work only on `atomic<u32>` and `atomic<i32>`, only in the `storage` address space with `read_write` access or in `workgroup` memory, and an atomic variable cannot be read with an ordinary expression, so `atomicLoad` is required even to look at it.

Atomic counters must be reset between frames, since they accumulate. The cheapest way is on the encoder, with no shader involved.

```js
encoder.clearBuffer(statsBuffer);
```

The cost of atomics is contention. When many invocations hit the same address the hardware serialises them, and a counter touched by every one of a hundred thousand invocations is a genuine bottleneck. The fix is a two level reduction, where each workgroup reduces privately in [[workgroup|workgroup memory]] and only one invocation per workgroup touches the global counter, cutting the contention by the workgroup size.

```wgsl
var<workgroup> partial: array<u32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u,
        @builtin(local_invocation_index) lid: u32) {

  partial[lid] = select(0u, 1u, gid.x < params.count && isArrived(gid.x));
  workgroupBarrier();

  var stride = 32u;
  while (stride > 0u) {
    if (lid < stride) { partial[lid] = partial[lid] + partial[lid + stride]; }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (lid == 0u) { atomicAdd(&stats.arrived, partial[0]); }
}
```

`workgroupBarrier()` makes every invocation in the workgroup wait until all of them have arrived, and it also ensures their writes to workgroup memory are visible to each other. It must be reached by every invocation in the workgroup, so it can never sit inside a branch that only some of them take. Notice that the barrier in the loop is outside the `if`, which is exactly why. An early `return` before a barrier is the same bug wearing a different hat.

Do not start here. Write the simple atomic version, measure, and add the two level reduction if it turns out to matter.

## Scatter with collisions, and fixed point

The hardest of the four. Many invocations contribute to many accumulators, and which accumulator any given invocation touches is only known at runtime.

Accumulating a weighted centre of mass per region is exactly this shape. Each invocation computes which region it belongs to and adds its position there, with an unknown number of collisions per region.

The obstacle is that WGSL has no floating point atomics at all. There is `atomic<u32>` and `atomic<i32>` and nothing else. Summing positions therefore needs [[fixed-point-accumulation|fixed point]], where you multiply by a scale factor, round to an integer, accumulate with `atomicAdd`, and divide by the scale on read.

```wgsl
const SCALE: f32 = 4096.0;

// pos is normalised to roughly 0..1 first
atomicAdd(&acc.sumX, i32(pos.x * SCALE));
atomicAdd(&acc.sumY, i32(pos.y * SCALE));
atomicAdd(&acc.count, 1u);
```

Then on read, `centroid = vec2f(f32(sumX), f32(sumY)) / (SCALE * f32(count))`.

Choosing the scale is a real design decision with a real failure mode, because an `i32` holds values up to about 2.1 billion and `atomicAdd` wraps silently on overflow. The budget is the number of contributors multiplied by the largest value each one adds. With a hundred thousand particles and a scale of 4096, the maximum sum is about 4.1e8, which is comfortable. Feeding raw pixel coordinates in instead, where a value might be 2000, gives 8.2e11 and overflows without a single warning.

The two rules that follow are to normalise coordinates into a zero to one range before scaling, and to pick the scale from an explicit worst case calculation rather than by taste. A scale of 4096 gives about four decimal digits of precision on a normalised coordinate, which is far more than a screen position needs.

If you ever genuinely need float atomics, they can be emulated with `atomicCompareExchangeWeak` in a retry loop over the bit pattern. It is slow and rarely worth it, and fixed point is the standard answer.

## Ping-pong

Some algorithms are iterative, where each pass reads the whole previous state and writes a whole new one. Doing that in place is a data race by construction, since one invocation would read a neighbour's value that another invocation has already overwritten.

The solution is [[ping-pong-buffering|ping-pong buffering]], which keeps two buffers and swaps their roles every pass.

```js
let src = bufferA, dst = bufferB;

for (let i = 0; i < passes; i++) {
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroupFor(src, dst));
  pass.dispatchWorkgroups(groups);
  pass.end();

  [src, dst] = [dst, src];
}
```

Prepare both bind groups once at initialisation and alternate between them, rather than creating one per pass. The passes are separate dispatches rather than a loop inside a single shader for a reason that comes straight from the ownership rule, which is that there is no synchronisation between workgroups within a dispatch, so the only way to guarantee that every invocation has finished writing before any invocation starts reading is to end the pass.

[[14_voronoi-and-jump-flooding|Jump flooding]] is built entirely on this, and after an odd number of passes the result is in the buffer you started with, which is a bookkeeping detail worth handling deliberately rather than discovering.

## Choosing between them

Use a map when each output depends on one input. Use a reduction when many inputs produce one output. Use scatter with fixed point atomics when many inputs produce many outputs and the destination is data dependent. Use ping-pong when the algorithm iterates over its own output.

## Checkpoint

All four ideas in one program. Particles orbit under a compute pass, which is a map. Those inside a circle around the pointer are counted with an atomic, which is a reduction. Their centre of mass is accumulated with fixed point atomics, which is scatter into a single bucket. The results are read back into the render stage without ever going to the CPU, and shown as a bar and a marker.

```html
<!doctype html>
<meta charset="utf-8">
<title>Parallel patterns</title>
<style>
  html, body { margin: 0; height: 100%; background: #08080c; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
<canvas></canvas>
<script type="module">
const canvas = document.querySelector('canvas');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

const COUNT = 100000;
const STRIDE = 32;
const WG = 64;
const RADIUS = 220;

const bytes = new ArrayBuffer(COUNT * STRIDE);
const f32 = new Float32Array(bytes);
const u32 = new Uint32Array(bytes);

for (let i = 0; i < COUNT; i++) {
  const b = (i * STRIDE) / 4;
  f32[b + 0] = Math.random() * 1600;
  f32[b + 1] = Math.random() * 1000;
  const h = i / COUNT;
  u32[b + 4] =
    Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * h))) |
    (Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * h + 2.09))) << 8) |
    (Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * h + 4.19))) << 16) |
    (150 << 24);
  f32[b + 5] = 1.0 + Math.random() * 1.5;
  f32[b + 6] = Math.random();
}

const particles = device.createBuffer({
  size: bytes.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(particles, 0, bytes);

// Stats: u32 inside, i32 sumX, i32 sumY, u32 pad
const stats = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const paramsBytes = new ArrayBuffer(32);
const pF32 = new Float32Array(paramsBytes);
const pU32 = new Uint32Array(paramsBytes);
pU32[5] = COUNT;

const paramsBuffer = device.createBuffer({
  size: 32,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const shared = `
  struct Params {
    resolution: vec2f,
    pointer: vec2f,
    dt: f32,
    count: u32,
    time: f32,
    radius: f32,
  }

  struct Particle {
    pos: vec2f,
    vel: vec2f,
    colour: u32,
    radius: f32,
    seed: f32,
    flags: u32,
  }

  const SCALE: f32 = 4096.0;
`;

const computeModule = device.createShaderModule({
  code: shared + `
    struct Stats {
      inside: atomic<u32>,
      sumX: atomic<i32>,
      sumY: atomic<i32>,
      _pad: u32,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
    @group(0) @binding(2) var<storage, read_write> stats: Stats;

    var<workgroup> partial: array<u32, ${WG}>;

    @compute @workgroup_size(${WG})
    fn main(@builtin(global_invocation_id) gid: vec3u,
            @builtin(local_invocation_index) lid: u32) {

      let i = gid.x;
      var inside = false;

      // --- map: every particle drifts on its own slow orbit ---
      if (i < params.count) {
        var p = particles[i];
        let a = p.seed * 6.2831853 + params.time * 0.25;
        p.pos = p.pos + vec2f(cos(a), sin(a)) * 40.0 * params.dt;

        // Wrap so nothing escapes the screen.
        p.pos = (p.pos + params.resolution) % params.resolution;
        particles[i] = p;

        inside = distance(p.pos, params.pointer) < params.radius;

        // --- scatter: fixed point accumulation of a centre of mass ---
        if (inside) {
          let n = p.pos / params.resolution;      // normalise before scaling
          atomicAdd(&stats.sumX, i32(n.x * SCALE));
          atomicAdd(&stats.sumY, i32(n.y * SCALE));
        }
      }

      // --- reduction: count inside the workgroup first, then once globally ---
      partial[lid] = select(0u, 1u, inside);
      workgroupBarrier();

      var stride = ${WG >> 1}u;
      while (stride > 0u) {
        if (lid < stride) { partial[lid] = partial[lid] + partial[lid + stride]; }
        workgroupBarrier();
        stride = stride / 2u;
      }

      if (lid == 0u && partial[0] > 0u) {
        atomicAdd(&stats.inside, partial[0]);
      }
    }
  `,
});

const renderModule = device.createShaderModule({
  code: shared + `
    struct Stats {
      inside: u32,
      sumX: i32,
      sumY: i32,
      _pad: u32,
    }

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) local: vec2f,
      @location(1) colour: vec4f,
      @location(2) radius: f32,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> particles: array<Particle>;
    @group(0) @binding(2) var<storage, read> stats: Stats;

    fn toClip(pixel: vec2f) -> vec4f {
      return vec4f(
         (pixel.x / params.resolution.x) * 2.0 - 1.0,
        -((pixel.y / params.resolution.y) * 2.0 - 1.0),
        0.0, 1.0);
    }

    @vertex
    fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
      let corner = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1))[v];
      let p = particles[i];
      let r = p.radius + 1.0;

      var out: VSOut;
      out.pos = toClip(p.pos + corner * r);
      out.local = corner;
      out.colour = unpack4x8unorm(p.colour);
      out.radius = r;
      return out;
    }

    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      let d = length(in.local);
      let w = 1.0 / max(in.radius, 1.0);
      let alpha = 1.0 - smoothstep(1.0 - w, 1.0, d);
      if (alpha <= 0.0) { discard; }
      let a = in.colour.a * alpha;
      return vec4f(in.colour.rgb * a, a);
    }

    // Overlay: a full screen pass that reads the stats the compute pass produced.
    @vertex
    fn vsOverlay(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
      return vec4f(p[i], 0.0, 1.0);
    }

    @fragment
    fn fsOverlay(@builtin(position) frag: vec4f) -> @location(0) vec4f {
      var out = vec4f(0.0);

      // Selection ring around the pointer.
      let dRing = abs(distance(frag.xy, params.pointer) - params.radius);
      out += vec4f(1.0, 1.0, 1.0, 1.0) * clamp(1.0 - dRing, 0.0, 1.0) * 0.35;

      // Bar across the top, width proportional to the fraction counted.
      let frac = f32(stats.inside) / f32(params.count);
      if (frag.y < 8.0 && frag.x < frac * params.resolution.x) {
        out = vec4f(0.3, 1.0, 0.5, 1.0);
      }

      // Crosshair at the fixed point centre of mass.
      if (stats.inside > 0u) {
        let n = vec2f(f32(stats.sumX), f32(stats.sumY)) / (SCALE * f32(stats.inside));
        let c = n * params.resolution;
        let dC = abs(distance(frag.xy, c) - 10.0);
        out += vec4f(1.0, 0.9, 0.2, 1.0) * clamp(1.5 - dC, 0.0, 1.0);
      }

      return out;
    }
  `,
});

for (const m of [...(await computeModule.getCompilationInfo()).messages,
                 ...(await renderModule.getCompilationInfo()).messages]) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const computePipeline = device.createComputePipeline({
  layout: 'auto',
  compute: { module: computeModule, entryPoint: 'main' },
});

const blend = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

const drawPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module: renderModule, entryPoint: 'vs' },
  fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format, blend }] },
  primitive: { topology: 'triangle-strip' },
});

const overlayPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module: renderModule, entryPoint: 'vsOverlay' },
  fragment: { module: renderModule, entryPoint: 'fsOverlay', targets: [{ format, blend }] },
  primitive: { topology: 'triangle-list' },
});

const entries = [
  { binding: 0, resource: { buffer: paramsBuffer } },
  { binding: 1, resource: { buffer: particles } },
  { binding: 2, resource: { buffer: stats } },
];

const computeBind = device.createBindGroup({ layout: computePipeline.getBindGroupLayout(0), entries });
const drawBind    = device.createBindGroup({ layout: drawPipeline.getBindGroupLayout(0), entries });
const overlayBind = device.createBindGroup({ layout: overlayPipeline.getBindGroupLayout(0), entries });

let dpr = 1;
new ResizeObserver(([entry]) => {
  dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
}).observe(canvas);

const pointer = { x: 400, y: 300 };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX * dpr;
  pointer.y = e.clientY * dpr;
});

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  pF32[0] = canvas.width;
  pF32[1] = canvas.height;
  pF32[2] = pointer.x;
  pF32[3] = pointer.y;
  pF32[4] = dt;
  pF32[6] = now / 1000;
  pF32[7] = RADIUS * dpr;
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();

  // Atomics accumulate, so they must be reset every frame.
  encoder.clearBuffer(stats);

  const compute = encoder.beginComputePass();
  compute.setPipeline(computePipeline);
  compute.setBindGroup(0, computeBind);
  compute.dispatchWorkgroups(Math.ceil(COUNT / WG));
  compute.end();

  const render = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.03, g: 0.03, b: 0.05, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  render.setPipeline(drawPipeline);
  render.setBindGroup(0, drawBind);
  render.draw(4, COUNT);

  render.setPipeline(overlayPipeline);
  render.setBindGroup(0, overlayBind);
  render.draw(3);
  render.end();

  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

Move the pointer around. A white ring follows it, a green bar at the top grows and shrinks with the fraction of particles inside the ring, and a yellow crosshair tracks the centre of mass of exactly those particles. All three numbers are computed on the GPU and consumed on the GPU, with the CPU only ever uploading a pointer position.

Notice the same buffer is declared with `atomic<u32>` in the compute module and plain `u32` in the render module. That is deliberate and legal, since a buffer is only bytes and the atomic wrapper describes how a particular shader intends to access it. The render pass only reads, and reading during a pass where nothing writes needs no atomicity.

Four experiments. Comment out `encoder.clearBuffer(stats)` and watch the bar saturate within a second, which is what an unreset accumulator looks like. Replace the workgroup reduction with a bare `atomicAdd(&stats.inside, 1u)` per particle and compare frame times with the ring covering most of the screen, which is where contention bites. Change `SCALE` to `4096.0 * 4096.0` and watch the crosshair fly off as `i32` overflows and wraps. Finally remove the normalisation, adding `p.pos.x * SCALE` directly, and see the same overflow arrive from a different direction.

## Failure modes

A value that is correct at low counts and wrong at high counts is an overflow in a fixed point accumulator.

A hang, a device loss, or a validation error mentioning uniform control flow means `workgroupBarrier()` is inside a branch or after an early `return` that only some invocations take.

Results that change between runs, or differ between machines, mean an unsynchronised write, so two invocations are writing the same location without an atomic.

Statistics that climb without bound are an accumulator that is never cleared.

A crosshair that sits at the origin when the count is zero is a division by zero, which is why the checkpoint guards on `stats.inside > 0u`.

## Resources

[webgpufundamentals.org, Compute shaders, and the reduction examples that follow it](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html) cover workgroup memory and barriers in more depth.

The [WGSL atomic built in functions](https://www.w3.org/TR/WGSL/#atomic-builtin-functions) section is short and worth reading once in full, since the list of what exists is the list of what you can do.
