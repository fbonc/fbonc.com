# Debugging and performance

There is no `console.log` in a shader. There is no breakpoint, no stepping, and no stack trace. A shader that is wrong produces a picture that is wrong, and the gap between those two things is where all the time goes.

The good news is that the techniques are few and they work. Learn them before you need them, because the moment you need them is the worst moment to be learning them.

## The four tools, in order

Reach for these in sequence, because they are ordered by how much effort they cost.

Validation errors come first, since WebGPU catches a large fraction of mistakes and tells you precisely what is wrong. Drawing the data comes second, since rendering an intermediate value as colour is the closest thing a shader has to printing. Readback comes third, when you need actual numbers rather than an impression. Profiling comes last, and only once the thing is correct.

## Validation, labels, and error scopes

Label everything. Every buffer, texture, pipeline, bind group, and shader module accepts a `label`, it costs nothing, and it is the difference between an error that names your particle buffer and one that names an anonymous object.

Uncaught errors go to the console by default, but a handler makes them impossible to miss.

```js
device.addEventListener('uncapturederror', (e) => {
  console.error('WebGPU error:', e.error.message);
});
```

To attribute an error to a specific piece of code, wrap it in an error scope. This is what turns a vague complaint into a precise one, since scopes can be nested and the innermost matching one captures the error.

```js
device.pushErrorScope('validation');

const pipeline = device.createRenderPipeline({ ... });

device.popErrorScope().then((error) => {
  if (error) console.error('pipeline creation failed:', error.message);
});
```

The three scope types are `validation` for API misuse, `out-of-memory` for allocation failures, and `internal` for driver problems. In a development build it is reasonable to wrap the whole of initialisation in a validation scope and to wrap each frame in one, then remove the per frame scope in production, since popping a scope forces a small amount of synchronisation.

Shader compilation is separate, and its messages do not arrive through error scopes. Wire up `getCompilationInfo()` from the very first shader, as every checkpoint in this sequence has done, because a module with errors produces a pipeline that silently draws nothing.

## Drawing the data

This is the technique that pays for itself repeatedly, and the one people adopt too late.

Any value in a shader can be turned into a colour. Velocity becomes a hue and a brightness. A per particle progress value becomes a greyscale ramp. A cell index becomes a colour by hashing it. A boolean becomes red or green. Once it is on screen, a bug that was invisible in the final image is usually obvious.

```wgsl
// Debug views, selected by a uniform.
switch (params.debugView) {
  case 1u: { colour = vec3f(normalize(p.vel) * 0.5 + 0.5, 0.5); }
  case 2u: { colour = vec3f(p.progress); }
  case 3u: { colour = hashColour(p.cell); }
  default: { colour = normalColour; }
}
```

Build this into the renderer early, driven by a number in the uniform block and a keyboard shortcut. It costs an hour and it will save many. The specific views worth having are whatever intermediate quantity your current pass produces, so the set grows as the engine does.

Two related habits. When a shader produces nothing at all, put `return vec4f(1,0,0,1)` at the top of the fragment shader to confirm it is running, then move the early return progressively later to bisect. And when a value might be out of range, clamp it and colour the clamped case distinctly, so that out of range becomes visible rather than merely wrong.

## Readback for numbers

When you need exact values, copy the suspect buffer to a staging buffer and map it, using the pattern from [[11_frame-loop-and-readback|the readback note]]. For debugging you can afford to await it, since a stall does not matter when you are inspecting a single frame.

A useful trick is a dedicated debug buffer that shaders write diagnostics into, indexed by invocation, which gives you the shader's equivalent of a log line.

```wgsl
@group(0) @binding(9) var<storage, read_write> debugOut: array<vec4f>;

if (i < 64u) { debugOut[i] = vec4f(p.pos, p.vel); }
```

Restricting it to the first 64 invocations keeps the buffer small and the output readable, and printing 64 particles is nearly always enough to see the pattern.

Add a boot time assertion comparing your JavaScript struct size against what the shader expects, as [[06_memory-layout-and-alignment|the alignment note]] recommends. A mismatch caught at startup costs seconds. The same mismatch found by staring at scrambled particles costs a day.

## Finding out what is slow

Before optimising anything, find out which machine is the bottleneck, because the answer changes what you should do and guessing is usually wrong.

The Chrome DevTools performance panel shows CPU time directly. If your JavaScript frame callback is taking most of the budget, the problem is on the CPU, and the usual causes are creating pipelines or bind groups inside the loop, uploading large buffers every frame, or a synchronous readback.

If the CPU is idle and the frame rate is still low, the GPU is the bottleneck, and two quick experiments narrow it down further. Halve the canvas resolution, and if the frame rate improves substantially you are fragment bound, meaning too many pixels are being shaded, which for a particle field means the radii are too large or too many particles overlap. Halve the particle count instead, and if that is what helps you are bound by vertex or compute work, meaning the count itself is the problem.

That pair of experiments takes two minutes and is more reliable than any amount of reasoning about the code.

## GPU timing

For per pass numbers you need the optional `timestamp-query` feature, which must be requested at device creation and may not be present.

```js
const canTime = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
  requiredFeatures: canTime ? ['timestamp-query'] : [],
});
```

Timestamps are written by the pass itself, then resolved into a buffer and copied out.

```js
const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });

const resolve = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
});

const pass = encoder.beginComputePass({
  timestampWrites: {
    querySet,
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1,
  },
});
// ... the pass
pass.end();

encoder.resolveQuerySet(querySet, 0, 2, resolve, 0);
encoder.copyBufferToBuffer(resolve, 0, staging, 0, 16);
```

The values are 64 bit nanosecond counters, so read them with a `BigInt64Array` and subtract.

```js
const t = new BigInt64Array(staging.getMappedRange());
const ms = Number(t[1] - t[0]) / 1e6;
```

Browsers quantise these timestamps to limit their use as a timing side channel, so treat them as relative measurements over many frames rather than exact figures. Comparing two passes, or one pass before and after a change, is what they are good for.

An engine should treat this as strictly optional and work identically without it.

## The performance problems you will actually have

In rough order of how often they occur.

Creating GPU objects inside the frame loop. Pipelines are the worst offender since they compile shaders, but bind groups and buffers are also meant to be created once. If an object could be created at initialisation, create it there.

Fragment overdraw. As noted in [[07_instanced-drawing-and-sdf-circles|the instancing note]], fragment cost scales with covered area, so doubling every radius quadruples the work. This is by far the most common cause of a slow particle field.

Synchronous readback. Covered in the previous note, and it is catastrophic rather than merely slow.

Large per frame uploads. A small uniform block per frame is fine, and a megabyte of particle data per frame means the design has gone wrong somewhere.

Workgroup sizes below 32, which waste most of every lockstep group. Use 64 for linear work and 8 by 8 for grids unless measurement says otherwise.

Scattered memory access. Adjacent invocations reading adjacent memory is fast, and adjacent invocations reading randomly across a large buffer is slow, which is one of the reasons [[16_spatial-ordering-and-matching|spatial ordering]] is worth doing at all.

Branch divergence, when neighbouring invocations take different paths through a shader. It is real but it is far down the list, and it is worth thinking about only once the obvious things are done.

## Checkpoint

Instrument the [[09_parallel-patterns|parallel patterns]] checkpoint with the three things every project should have from the start, which are a debug view toggle, an error scope around initialisation, and optional GPU timing.

Add a debug view field to the params struct and use it in the fragment shader.

```wgsl
// in Params
debugView: u32,

// in fs, replacing the final return
var rgb = in.colour.rgb;
if (params.debugView == 1u) { rgb = vec3f(in.radius / 4.0); }
if (params.debugView == 2u) { rgb = vec3f(f32(stats.inside) / f32(params.count), 0.2, 0.2); }
let a = in.colour.a * alpha;
return vec4f(rgb * a, a);
```

Bind it to a key.

```js
let debugView = 0;
addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '3') debugView = Number(e.key);
});
```

Wrap initialisation in an error scope so that any setup mistake is attributed rather than merely reported.

```js
device.pushErrorScope('validation');
// ... all buffer, texture, and pipeline creation
const initError = await device.popErrorScope();
if (initError) throw new Error('init failed: ' + initError.message);
```

Add timing if the feature is present, resolving into the staging pool you already have and printing a rolling average into the HUD.

Then confirm each tool works by breaking something on purpose. Remove `GPUBufferUsage.COPY_DST` from the params buffer and check that the error scope names it. Set the debug view to a mode you have not implemented and confirm it falls through to the normal colour rather than producing black. Multiply every radius by six and watch the frame time in the performance panel climb, then halve the canvas size and watch it recover, which is the fragment bound diagnosis working exactly as described.

## Failure modes

An error appearing with no indication of where it came from means nothing is labelled, which is fixable in ten minutes and worth doing immediately.

A shader that seems not to run at all is usually a compilation error going unreported, so check `getCompilationInfo`.

Timing numbers that are zero or identical mean the `timestamp-query` feature was not actually enabled on the device, since checking the adapter is not the same as requesting it.

A performance measurement that improves when you add logging, or changes when DevTools is open, is measuring the wrong thing. Measure over many frames with a rolling average rather than single samples.

## Resources

[webgpufundamentals.org, Timing](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html) implements a reusable timing helper around `timestamp-query`.

[MDN, GPUDevice.pushErrorScope](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/pushErrorScope) documents the scope stack and the three error filters.

Chrome's `chrome://gpu` page reports which backend is in use and whether hardware acceleration is active, which is the first thing to check when performance is inexplicably poor on one machine.
