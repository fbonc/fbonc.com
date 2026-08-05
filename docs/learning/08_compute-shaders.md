# Compute shaders

Everything so far has been about drawing. Compute is the other half of WebGPU, and for a particle engine it is the larger half, because all simulation lives here.

A compute shader is a function with no triangles, no pixels, and no fixed pipeline around it. You ask for it to be run some number of times, and its only way to have any effect is to write into a storage buffer or a storage texture.

## Invocations, workgroups, dispatches

Three levels of grouping, and the names matter because the API uses them precisely.

An invocation is one execution of your function, so one thread, and typically one particle.

A [[workgroup|workgroup]] is a fixed size block of invocations that are scheduled together on one compute unit. They can share memory and can synchronise with each other. You declare the size in the shader with `@workgroup_size(x, y, z)`, and the product of the dimensions must not exceed `maxComputeInvocationsPerWorkgroup`, which is 256 on essentially all hardware.

A dispatch is one command that launches a grid of workgroups. `pass.dispatchWorkgroups(x, y, z)` launches `x * y * z` of them, and each dimension is capped at `maxComputeWorkgroupsPerDimension`, usually 65535.

So the total invocation count is the workgroup size multiplied by the dispatch size, and both halves are chosen by you.

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  ...
}
```

## Choosing a workgroup size

For one dimensional work over an array, use 64. It is the right answer often enough that you should need a reason to deviate.

The reasoning is that hardware executes invocations in lockstep groups of 32 on NVIDIA and Intel and 64 on AMD, so a workgroup size that is not a multiple of 32 wastes lanes outright. Sizes below 32 waste more than half the machine, and very large sizes reduce how many workgroups can be resident at once, which reduces the hardware's ability to hide memory latency. 64 sits comfortably in the middle and divides evenly on every vendor.

Use a two dimensional size like `@workgroup_size(8, 8)` when the data is naturally a grid, such as a texture, because neighbouring invocations then touch neighbouring pixels and memory access stays coherent. That is the shape used by the [[14_voronoi-and-jump-flooding|jump flooding]] passes.

The number is baked into the compiled shader, which is one reason `override` constants exist, since they let the value be chosen at pipeline creation without editing the source.

## Dispatch arithmetic and the bounds check

The dispatch count is in workgroups, not invocations, so you divide and round up.

```js
const WORKGROUP_SIZE = 64;
pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
```

Rounding up means you almost always launch more invocations than you have items. With 100000 particles and a workgroup size of 64 you get 1563 workgroups and therefore 100032 invocations, so 32 of them have no particle to work on.

Those extra invocations must be stopped, and this is not optional.

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) { return; }
  ...
}
```

WebGPU will clamp or discard an out of bounds access rather than corrupting memory, so this will not crash. It will silently produce wrong results, since a clamped write means several invocations all writing to the last element. Write the guard first, before the body, every time.

The related builtins are worth knowing. `global_invocation_id` is the index within the entire dispatch, `local_invocation_id` is the index within the workgroup, `workgroup_id` identifies the workgroup, and `local_invocation_index` is the flattened local index, which is the convenient one for indexing [[workgroup|workgroup memory]].

## The compute pipeline and pass

The API mirrors the render side, with less to configure.

```js
const pipeline = device.createComputePipeline({
  label: 'integrate',
  layout: 'auto',
  compute: { module, entryPoint: 'main' },
});

const encoder = device.createCommandEncoder();
const pass = encoder.beginComputePass();
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.dispatchWorkgroups(Math.ceil(count / 64));
pass.end();
device.queue.submit([encoder.finish()]);
```

There is no `targets`, no topology, and no blending, because there is no output stage. Output happens because the shader writes to a bound resource.

## Reading and writing

A compute shader that modifies data in place declares the buffer `read_write`.

```wgsl
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) { return; }

  var p = particles[i];
  p.vel = p.vel + accel * params.dt;
  p.pos = p.pos + p.vel * params.dt;
  particles[i] = p;
}
```

The pattern of copying the struct into a local `var`, modifying it, and writing it back once is deliberate. It reads clearly and it does one coalesced read and one coalesced write rather than several scattered ones.

The safety rule underneath all of this is the one to internalise. Each invocation owns exactly one slot and writes only to that slot. There is no coordination, no locking, and no defined order of execution between invocations. If two invocations write to the same location the result is undefined, and the only sanctioned way to have many invocations affect one location is [[atomics|atomics]], which is [[09_parallel-patterns|the next note]].

This is why simple per particle work is the easy case. Each particle reads its own state, computes, and writes its own state. Nothing else is involved.

## Ordering between passes

You do not insert barriers between passes. WebGPU tracks which resources each pass reads and writes, and inserts whatever synchronisation the hardware needs.

So a frame that runs a compute pass writing the particle buffer, then a render pass reading it, is correct simply by being recorded in that order.

```js
const encoder = device.createCommandEncoder();

const compute = encoder.beginComputePass();
// ... writes particles
compute.end();

const render = encoder.beginRenderPass({ ... });
// ... reads particles
render.end();

device.queue.submit([encoder.finish()]);
```

Within a single pass there is no such guarantee, and no ordering between workgroups at all, which is exactly why multi pass algorithms like jump flooding are structured as a sequence of separate dispatches rather than a loop inside one shader.

## Frame rate independent motion

Simulation needs a time step, and taking it from the wall clock is the only correct approach when frame rate varies.

The integration scheme to use is semi implicit Euler, which updates velocity first and then uses the new velocity to update position. It costs the same as the naive ordering and is markedly more stable for anything springlike.

```wgsl
p.vel = p.vel + accel * dt;
p.pos = p.pos + p.vel * dt;
```

Clamp `dt` on the CPU before uploading it. A tab that has been in the background produces an enormous first frame delta, and an unclamped step will fling every particle to infinity in one frame.

```js
const dt = Math.min((now - last) / 1000, 1 / 30);
```

For smoothing toward a target, the naive `x += (target - x) * 0.1` is frame rate dependent and will behave differently at 60 and 120 Hz. The correct form is exponential and costs one call.

```wgsl
let k = 1.0 - exp(-rate * dt);
p.pos = mix(p.pos, target, k);
```

## Checkpoint

The particle field from the previous note, now simulated. A compute pass steers every particle toward the pointer with damping, and the render pass draws the result. Two passes, one submit, and the CPU never touches a particle.

```html
<!doctype html>
<meta charset="utf-8">
<title>Compute</title>
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

const bytes = new ArrayBuffer(COUNT * STRIDE);
const f32 = new Float32Array(bytes);
const u32 = new Uint32Array(bytes);

for (let i = 0; i < COUNT; i++) {
  const b = (i * STRIDE) / 4;
  f32[b + 0] = Math.random() * 2000;
  f32[b + 1] = Math.random() * 2000;
  f32[b + 2] = 0;
  f32[b + 3] = 0;
  const h = i / COUNT;
  const r = Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * h)));
  const g = Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * h + 2.09)));
  const bl = Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * h + 4.19)));
  u32[b + 4] = r | (g << 8) | (bl << 16) | (180 << 24);
  f32[b + 5] = 1.0 + Math.random() * 2.0;
  f32[b + 6] = Math.random();
  u32[b + 7] = 0;
}

const particles = device.createBuffer({
  label: 'particles',
  size: bytes.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(particles, 0, bytes);

// vec2f resolution, vec2f pointer, f32 dt, u32 count, f32 time, f32 _pad
const paramsBytes = new ArrayBuffer(32);
const pF32 = new Float32Array(paramsBytes);
const pU32 = new Uint32Array(paramsBytes);
pU32[5] = COUNT;

const paramsBuffer = device.createBuffer({
  size: paramsBytes.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const shared = `
  struct Params {
    resolution: vec2f,
    pointer: vec2f,
    dt: f32,
    count: u32,
    time: f32,
    _pad: f32,
  }

  struct Particle {
    pos: vec2f,
    vel: vec2f,
    colour: u32,
    radius: f32,
    seed: f32,
    flags: u32,
  }
`;

const computeModule = device.createShaderModule({
  label: 'integrate',
  code: shared + `
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

    @compute @workgroup_size(${WG})
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let i = gid.x;
      if (i >= params.count) { return; }

      var p = particles[i];

      // Each particle orbits its own point on a ring around the pointer.
      let angle = p.seed * 6.2831853 + params.time * 0.4;
      let ring = 120.0 + 260.0 * p.seed;
      let target = params.pointer + vec2f(cos(angle), sin(angle)) * ring;

      let toTarget = target - p.pos;
      p.vel = p.vel + toTarget * 6.0 * params.dt;
      p.vel = p.vel * exp(-3.0 * params.dt);       // frame rate independent damping
      p.pos = p.pos + p.vel * params.dt;

      particles[i] = p;
    }
  `,
});

const renderModule = device.createShaderModule({
  label: 'draw',
  code: shared + `
    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) local: vec2f,
      @location(1) colour: vec4f,
      @location(2) radius: f32,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> particles: array<Particle>;

    @vertex
    fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
      let corner = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1))[v];
      let p = particles[i];
      let r = p.radius + 1.0;
      let pixel = p.pos + corner * r;

      var out: VSOut;
      out.pos = vec4f(
         (pixel.x / params.resolution.x) * 2.0 - 1.0,
        -((pixel.y / params.resolution.y) * 2.0 - 1.0),
        0.0, 1.0);
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
  `,
});

for (const m of [...(await computeModule.getCompilationInfo()).messages,
                 ...(await renderModule.getCompilationInfo()).messages]) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const computePipeline = device.createComputePipeline({
  label: 'integrate',
  layout: 'auto',
  compute: { module: computeModule, entryPoint: 'main' },
});

const renderPipeline = device.createRenderPipeline({
  label: 'draw',
  layout: 'auto',
  vertex:   { module: renderModule, entryPoint: 'vs' },
  fragment: {
    module: renderModule, entryPoint: 'fs',
    targets: [{
      format,
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
    }],
  },
  primitive: { topology: 'triangle-strip' },
});

// Separate bind groups because the two pipelines have different automatic layouts,
// and because the same buffer is read_write in one and read in the other.
const computeBind = device.createBindGroup({
  layout: computePipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: particles } },
  ],
});

const renderBind = device.createBindGroup({
  layout: renderPipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: particles } },
  ],
});

let dpr = 1;
new ResizeObserver(([entry]) => {
  dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
}).observe(canvas);

const pointer = { x: 0, y: 0 };
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
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();

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
  render.setPipeline(renderPipeline);
  render.setBindGroup(0, renderBind);
  render.draw(4, COUNT);
  render.end();

  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

A hundred thousand particles should stream toward your pointer and settle into a slowly rotating disc, following it as you move.

Then run the experiments. Delete the `if (i >= params.count) { return; }` guard and change `COUNT` to a number that is not a multiple of 64, such as 100001, then look closely at the result to see the artefact that the guard prevents. Change the workgroup size to 1 and compare frame times, which shows the cost of wasting lanes. Remove the `Math.min` clamp on `dt`, switch to another tab for ten seconds, and come back to watch every particle vanish in a single frame.

## Failure modes

Nothing moves at all, and there is no error. Check that the compute pass is being submitted, that the dispatch count is not zero, and that the particle buffer really has `STORAGE` usage.

A validation error about a binding not being writable means the shader declared `read` where it needs `read_write`, or the automatic layout inferred read only because the shader never actually writes.

Particles that jitter or move at different speeds when the frame rate changes mean `dt` is not being applied, or a smoothing constant is being used without the exponential form.

Everything disappearing in a single frame is nearly always an unclamped `dt` or a spring constant large enough to make the integration unstable, which is worth recognising because both look identical.

## Resources

[webgpufundamentals.org, Compute shaders](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html) covers dispatch, workgroups, and the invocation builtins with diagrams.

[Surma, WebGPU: All of the cores, none of the canvas](https://surma.dev/things/webgpu/) is the best compute focused introduction written, though it predates the final API so some names differ.
