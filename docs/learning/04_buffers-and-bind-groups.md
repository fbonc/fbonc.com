# Buffers and bind groups

A shader that hardcodes its own data is a demonstration. Everything real needs to read memory you control, which means two new ideas, buffers to hold the data and bind groups to make a shader able to see it.

## Buffers

A [[gpubuffer|GPUBuffer]] is a flat, untyped block of GPU memory. It has a size in bytes and a set of usage flags, and that is the whole of it. There is no element type, no length, and no structure. Meaning comes entirely from how a shader chooses to interpret the bytes, which is why [[06_memory-layout-and-alignment|memory layout]] gets a note of its own.

```js
const buffer = device.createBuffer({
  label: 'params',
  size: 32,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
```

[[buffer-usage-flags|Usage flags]] are declared once and enforced forever. A buffer created without `COPY_DST` cannot be written by `writeBuffer`, and a buffer without `STORAGE` cannot be bound as a storage buffer, regardless of what the shader wants. Declare exactly what you need, because some combinations are illegal, notably `MAP_READ` with `STORAGE`, which is why [[11_frame-loop-and-readback|readback]] requires a separate staging buffer.

Sizes must be a multiple of 4 bytes, and in practice you should round up further to match struct alignment.

## Uniform and storage

Two kinds of buffer binding matter here, and the difference is a real hardware distinction rather than a naming convention.

A uniform buffer is small, read only, and identical across every invocation in a dispatch or draw. Think of it as the parameter block: time, resolution, particle count, gravity, mouse position. The guaranteed minimum size is only 64 KiB, and uniform data usually lives in a fast constant path on the hardware. Uniform arrays also carry a painful constraint on element stride, discussed in the alignment note, which is a good reason to keep uniforms to a single flat struct.

A storage buffer is large, and can be read only or read and write. This is where bulk data lives, so all particle state, all target positions, all accumulators. The default binding limit is 128 MiB and can often be raised. Writable storage buffers are how a compute shader produces output at all.

The rule of thumb is simple enough. If there is one of it, make it uniform. If there are a hundred thousand of them, make it storage.

## Writing data from the CPU

The ordinary path is `queue.writeBuffer`, which copies from a typed array into GPU memory.

```js
const params = new Float32Array([canvas.width, canvas.height, timeSeconds, 0]);
device.queue.writeBuffer(buffer, 0, params);
```

The arguments are the destination buffer, a byte offset into it, and the source data. The copy is queued rather than immediate, but WebGPU takes its own snapshot of your typed array during the call, so you are free to modify or reuse the array immediately afterwards.

There is a second path, `mappedAtCreation`, which is the right choice for data you upload exactly once at initialisation.

```js
const buffer = device.createBuffer({
  size: data.byteLength,
  usage: GPUBufferUsage.STORAGE,
  mappedAtCreation: true,
});
new Float32Array(buffer.getMappedRange()).set(data);
buffer.unmap();
```

This writes straight into the buffer's memory with no intermediate copy, and it notably does not require `COPY_DST`. After `unmap()` the buffer is normal and the mapped range is invalid.

Prefer `writeBuffer` for anything you update repeatedly. It is simple, it is fast enough for the occasional upload a scene change requires, and it avoids the asynchronous complexity of mapping a live buffer.

## Typed array views

Building buffer contents in JavaScript means [[typed-array-views|typed array views]] over a single `ArrayBuffer`, because a struct with mixed `f32` and `u32` fields cannot be expressed by one view alone.

```js
const bytes = new ArrayBuffer(32);
const f32 = new Float32Array(bytes);
const u32 = new Uint32Array(bytes);

f32[0] = 1920;      // resolution.x
f32[1] = 1080;      // resolution.y
f32[2] = 0.016;     // dt
u32[3] = 100000;    // count
```

Both views address the same memory, and index 3 means byte offset 12 in each because both element types are 4 bytes wide. That coincidence holds for `f32`, `u32` and `i32` and breaks the moment you use anything else, so `DataView` is the safer tool when the layout is irregular. For the regular case, overlapping views are the standard idiom and are what an engine actually uses.

## Bind groups

A shader cannot reach a buffer just because the buffer exists. Resources are made visible through bind groups, and the model has two halves.

A [[bind-group-layout|bind group layout]] is the contract. It says that binding 0 is a uniform buffer, binding 1 is a read only storage buffer, and so on, along with which shader stages may see each one. A bind group is an instance of that contract, naming the actual buffers.

The separation exists so that the expensive validation happens once against the layout, and swapping which buffers are in use per frame is cheap. It is the same idea as a type and a value.

In WGSL, bindings are declared with two numbers.

```wgsl
struct Params {
  resolution: vec2f,
  time: f32,
  count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
```

The group number selects which bind group, since you may bind up to four simultaneously, and the binding number selects the slot within it. Groups exist so that resources can be organised by update frequency, with slow changing data in group 0 and per draw data in group 3, which lets you rebind only what changed. A single group is fine until it is not.

On the JavaScript side, with `layout: 'auto'`, you fetch the inferred layout from the pipeline.

```js
const bindGroup = device.createBindGroup({
  label: 'frame',
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: pointsBuffer } },
  ],
});
```

Then, inside the pass, `pass.setBindGroup(0, bindGroup)` before the draw.

Note `array<vec2f>` with no length in the shader. A storage buffer array may be unsized, in which case its length comes from the size of the bound buffer at runtime and `arrayLength(&points)` returns it. Uniform arrays must have a fixed size known at compile time. This is another reason bulk data is storage.

## The shape of an engine's resources

It is worth seeing where this ends up, in the abstract. A particle system typically has one uniform buffer of frame parameters rewritten every frame with `writeBuffer`, one large storage buffer of particle state written only by the GPU, one storage buffer of targets uploaded when the scene changes, and one small storage buffer for statistics that gets copied out for readback. Four buffers, one or two bind groups, and the per frame CPU cost is a single small `writeBuffer` call.

## Checkpoint

A full screen quad whose colour is driven by a uniform buffer, and whose brightness is modulated by values read from a storage buffer. This exercises both binding types at once.

```html
<!doctype html>
<meta charset="utf-8">
<title>Buffers and bind groups</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
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

// Eight ring radii, uploaded once and never changed.
const RINGS = 8;
const radii = new Float32Array(RINGS);
for (let i = 0; i < RINGS; i++) radii[i] = 0.08 + 0.05 * i;

const radiiBuffer = device.createBuffer({
  label: 'radii',
  size: radii.byteLength,
  usage: GPUBufferUsage.STORAGE,
  mappedAtCreation: true,
});
new Float32Array(radiiBuffer.getMappedRange()).set(radii);
radiiBuffer.unmap();

// Params rewritten every frame: vec2f resolution, f32 time, u32 count.
const paramsBytes = new ArrayBuffer(16);
const paramsF32 = new Float32Array(paramsBytes);
const paramsU32 = new Uint32Array(paramsBytes);
paramsU32[3] = RINGS;

const paramsBuffer = device.createBuffer({
  label: 'params',
  size: paramsBytes.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const module = device.createShaderModule({
  label: 'rings',
  code: `
    struct Params {
      resolution: vec2f,
      time: f32,
      count: u32,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> radii: array<f32>;

    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      // Two triangles covering the whole screen.
      let p = array(
        vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3),
      );
      return vec4f(p[i], 0.0, 1.0);
    }

    @fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
      // Pixel coordinates to a square, centred, aspect corrected space.
      let uv = (frag.xy / params.resolution) * 2.0 - 1.0;
      let aspect = params.resolution.x / params.resolution.y;
      let p = vec2f(uv.x * aspect, uv.y);
      let d = length(p);

      var glow = 0.0;
      for (var i = 0u; i < params.count; i = i + 1u) {
        let r = radii[i] * (1.0 + 0.15 * sin(params.time + f32(i)));
        glow = glow + 0.004 / abs(d - r);
      }

      let colour = vec3f(0.2, 0.5, 1.0) * glow;
      return vec4f(colour, 1.0);
    }
  `,
});

for (const m of (await module.getCompilationInfo()).messages) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const pipeline = device.createRenderPipeline({
  label: 'rings',
  layout: 'auto',
  vertex:   { module, entryPoint: 'vs' },
  fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  primitive: { topology: 'triangle-list' },
});

const bindGroup = device.createBindGroup({
  label: 'frame',
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: radiiBuffer } },
  ],
});

const observer = new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
});
observer.observe(canvas);

function frame(timeMs) {
  paramsF32[0] = canvas.width;
  paramsF32[1] = canvas.height;
  paramsF32[2] = timeMs / 1000;
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

Eight glowing concentric rings should breathe in and out, staying circular as you resize the window.

Two things in here are worth noticing. The full screen triangle is deliberately oversized, running from -1 to 3, which covers the screen with three vertices instead of six and is a standard trick. And the aspect correction is why the rings stay round, since clip space is square while your window is not.

Now break it on purpose. Remove `GPUBufferUsage.COPY_DST` from the params buffer and read the validation error, which should name the buffer by its label and tell you exactly which usage is missing. That is the quality of error message you can expect throughout, and learning to trust it now saves hours later.

## Failure modes

A validation error saying a binding is missing or unused generally means the shader does not actually reference a resource you bound, since `layout: 'auto'` only generates entries for bindings the shader uses. Removing a use of a buffer during debugging silently changes the inferred layout.

A complaint that a bind group is incompatible with a pipeline means it was created from a different pipeline's automatic layout. Automatic layouts are not interchangeable.

Colours or values that are subtly wrong rather than absent are almost always a layout problem, not a binding problem, which is the subject of the note after next.

## Resources

[webgpufundamentals.org, Uniforms](https://webgpufundamentals.org/webgpu/lessons/webgpu-uniforms.html) and [Storage buffers](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html) cover this pair directly and are both short.

[webgpufundamentals.org, Bind group layouts](https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html) explains when to abandon `layout: 'auto'`, which is worth reading when you first need to share a bind group between two pipelines.
