# The GPU mental model

Before any API, the machine. Almost every strange thing about WebGPU follows from one fact, which is that the GPU is a separate computer with its own memory, and your JavaScript is not running on it.

## Two machines, one program

Your CPU runs a handful of very fast, very clever cores. It predicts branches, reorders instructions, and keeps large caches, all so that a single sequential thread of control finishes as soon as possible. It is optimised for latency.

A GPU is the opposite trade. It runs thousands of simple cores in lockstep groups, has comparatively small caches, and hides memory delays by having so many threads in flight that there is always some other thread ready to run. It is optimised for throughput. A single GPU thread is slow. A hundred thousand of them together are not.

The consequence is that a GPU is only worth using when you have the same operation to perform on a great many independent pieces of data. Moving a hundred thousand particles is exactly that shape of problem. Deciding which of four scenes to display is not, and stays on the CPU.

## Lockstep, and why branches cost

Cores are grouped into hardware units that execute a single instruction across many lanes at once, typically 32 or 64 of them. The vendor names differ, warp on NVIDIA and wavefront on AMD, but the behaviour is the same.

When threads in such a group disagree about a branch, the hardware cannot run both sides simultaneously. It runs the first side with the threads that did not take it masked off, then runs the second side with the others masked off. Both sides cost time. This is called divergence, and it means that a conditional in a shader is not free in the way a conditional in JavaScript is, though it only hurts when neighbouring threads actually disagree. A bounds check where all but the last few threads take the same path is close to free. A branch keyed on per-particle random noise is not.

You do not need to optimise for this yet. You need to know it exists, because it explains why shader code is written in a flat, arithmetic style that would look paranoid in ordinary CPU code.

## Separate memory

The GPU has its own memory, and on discrete cards it is physically on the other side of a bus. Getting data across is slow, and WebGPU makes every crossing explicit. There is no shared array, no pointer you can dereference from both sides, and no way to accidentally do it.

This is the single largest influence on how a GPU particle engine is designed. Particle positions live in GPU memory and stay there. The CPU does not read them each frame, does not write them each frame, and in a well built engine does not know what they are. It uploads new targets when a scene changes, which is rare, and otherwise sends only commands.

Reading data back to the CPU is worse than writing, because it is inherently asynchronous. You ask for a buffer to be mapped, and the answer arrives some frames later. Any design that needs a value back from the GPU in order to decide what to draw this frame is a design that will stall, so engines either avoid readback or accept that the data they get is stale.

## Commands, queues, and asynchrony

Your JavaScript does not run shaders. It records commands into a buffer, in the manner of writing a shopping list, then submits that list to a queue. The GPU works through the queue at its own pace. When `queue.submit()` returns, very likely nothing has happened yet.

So the two machines run concurrently, which is the point, and it means that ordinary debugging intuitions fail. An error caused by a command is reported long after the JavaScript line that recorded it has returned, which is why WebGPU has a dedicated error reporting mechanism rather than throwing exceptions. Timing a submit call with `performance.now()` measures how long it took to write the shopping list.

## Everything is declared in advance

WebGPU wants to know the shape of your work before it runs. Buffer sizes, what each buffer is allowed to be used for, which resources a shader can see, what format the output is, how blending works, all of it is fixed when you create pipelines and buffers rather than changed per draw.

This feels rigid coming from Canvas2D, where you set a fill colour and draw. The payoff is that the driver can validate and compile everything once, and then executing a frame is cheap. It also means the API can check your work aggressively, and WebGPU's validation messages are unusually good. They name the exact buffer, binding, and mismatch. Read them literally and completely, because they are nearly always telling the truth about a real problem.

The related payoff is safety. WebGPU is designed to run untrusted code from the web, so out of bounds access in a shader is clamped or discarded rather than reading arbitrary memory. You cannot crash the machine from a shader, but you can very easily produce garbage.

## The three shader stages

There are exactly three kinds of function that run on the GPU, and this project uses all three.

A vertex shader runs once per vertex and returns a position. A fragment shader runs once per pixel covered by a triangle and returns a colour. Between them sits the rasteriser, fixed hardware that works out which pixels a triangle covers, which is the one part of the pipeline you configure rather than program.

A compute shader is the general case, with no triangles and no pixels. It is a function you ask to be run some number of times, and its only way to produce a result is to write into a buffer or texture. All of the simulation in a particle engine is compute.

## What this project actually needs

The engine is a loop. Compute shaders read particle state from a buffer, integrate it forward by one time step, and write it back. A single instanced draw call then renders every particle as a small quad, with a fragment shader shaping each quad into a soft circle. The CPU picks scenes and uploads new targets occasionally.

That is the whole architecture, and it is why the notes that follow skip so much of graphics. You need buffers, bind groups, one render pipeline, several compute pipelines, textures for the stippling work, and a solid grasp of memory layout. That is close to the complete list.

## Checkpoint

Confirm the API exists and inspect the machine you are about to program. Create `checkpoint.html` and serve it over `localhost`.

```html
<!doctype html>
<meta charset="utf-8">
<title>WebGPU capability check</title>
<pre id="out">running…</pre>
<script type="module">
const out = document.getElementById('out');
const log = (s) => { out.textContent += s + '\n'; };
out.textContent = '';

if (!navigator.gpu) {
  log('navigator.gpu is undefined. This browser has no WebGPU.');
} else {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    log('requestAdapter() returned null. WebGPU exists but no adapter is available.');
  } else {
    const device = await adapter.requestDevice();
    log('preferred canvas format: ' + navigator.gpu.getPreferredCanvasFormat());
    log('');
    log('optional features supported by this adapter:');
    for (const f of [...adapter.features].sort()) log('  ' + f);
    log('');
    log('selected limits:');
    for (const k of [
      'maxComputeWorkgroupSizeX',
      'maxComputeInvocationsPerWorkgroup',
      'maxComputeWorkgroupsPerDimension',
      'maxStorageBufferBindingSize',
      'maxBufferSize',
      'maxTextureDimension2D',
    ]) log('  ' + k + ' = ' + device.limits[k]);
  }
}
</script>
```

You should see a format, usually `bgra8unorm`, a short list of features, and a set of limits.

Three things in that output matter later. `maxComputeInvocationsPerWorkgroup` is almost always 256, and it caps how large a [[workgroup|workgroup]] you may request. `maxStorageBufferBindingSize` defaults to 128 MiB, which is the ceiling on a single particle buffer and is worth knowing before you design one. `maxComputeWorkgroupsPerDimension` is typically 65535, which is large but not infinite, so a naive one-thread-per-item dispatch has an upper bound.

Note that `timestamp-query` may or may not appear in the feature list. It is optional, it is what [[12_debugging-and-performance|GPU profiling]] depends on, and an engine cannot assume it exists.

## Failure modes

If `navigator.gpu` is undefined, you are either on an unsupported browser or on a `file://` origin. Serve over `localhost` before concluding anything.

If `requestAdapter()` returns null despite a supported browser, the usual causes are a headless or virtualised environment, a blocklisted driver, or hardware acceleration disabled in browser settings. Note that it resolves to null rather than rejecting, so a missing null check here produces a confusing error one line later. Any real application needs this exact check as its capability gate.

## Resources

[webgpufundamentals.org, Fundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html) covers the same ground with a different emphasis and is worth reading now.

Fabian Giesen's [A trip through the Graphics Pipeline](https://fgiesen.wordpress.com/2011/07/09/a-trip-through-the-graphics-pipeline-2011-index/) is the canonical explanation of what the hardware is really doing. It is long, it predates WebGPU, and it is not required, but nothing else explains the machine as well.
