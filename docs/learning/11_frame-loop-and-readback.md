# Frame loop and readback

You now have every piece needed to compute and draw. This note is about running it continuously, and about the one direction of data flow that has been avoided so far, which is getting results back from the GPU.

## The shape of a frame

A frame is a fixed sequence, and keeping it in this order avoids most timing bugs.

Measure the elapsed time and clamp it. Update whatever CPU state the frame depends on, which is scene logic and input. Upload the small uniform block with `writeBuffer`. Create one command encoder, record the compute passes, then the render pass, and submit once. Request the next frame.

```js
let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  updateSceneLogic(dt);
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();
  recordComputePasses(encoder);
  recordRenderPass(encoder);
  device.queue.submit([encoder.finish()]);

  requestAnimationFrame(frame);
}
```

One encoder and one submit per frame is the default worth keeping. Submitting is not free, and splitting a frame across several submissions gains nothing unless you have a specific reason, such as needing a copy to be issued before some other work.

`requestAnimationFrame` is the correct clock. It fires in step with the display, it pauses when the tab is hidden, and its timestamp argument is more reliable than calling `performance.now()` yourself inside the callback. The refresh rate is not necessarily 60 Hz, since 120 Hz displays are common and an external monitor may differ from the built in one, which is why every rate in your simulation has to be expressed per second and multiplied by `dt`. This is covered in [[08_compute-shaders|the compute note]] and is worth being strict about, because rate dependence is invisible on the machine you develop on.

## Latency and pipelining

The GPU is typically working on the previous frame while the CPU records the next. That overlap is what keeps both busy, and it means a submitted frame appears on screen one or two frames later.

Ordinarily you never notice. It matters in exactly one situation, which is when the CPU asks for something the GPU has not finished producing. That request drains the pipeline, both machines idle while they resynchronise, and the frame rate collapses. Everything below is about avoiding that.

## Reading data back

Getting bytes from the GPU to JavaScript takes three steps, and the reason is a constraint from [[04_buffers-and-bind-groups|the buffers note]]. A buffer with `MAP_READ` usage cannot also have `STORAGE`, so the buffer your shader writes can never be the buffer you read.

So you keep a separate staging buffer, copy into it, and map it.

```js
const staging = device.createBuffer({
  label: 'readback',
  size: 16,
  usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
});

// during the frame, after the compute pass that produced the data
encoder.copyBufferToBuffer(statsBuffer, 0, staging, 0, 16);
device.queue.submit([encoder.finish()]);

// afterwards, asynchronously
await staging.mapAsync(GPUMapMode.READ);
const values = new Uint32Array(staging.getMappedRange()).slice();
staging.unmap();
```

The `.slice()` is required, not stylistic. The array returned by `getMappedRange` is a view into memory that becomes invalid the instant you call `unmap`, so you must copy the values out while the mapping is live. Reading the view afterwards throws, or worse, returns nothing useful.

A mapped buffer is unusable by the GPU until unmapped, so always unmap, including on the error path.

## Not stalling on it

Naively awaiting the map inside the frame loop is the mistake, because `mapAsync` cannot resolve until the GPU has finished the work that produced the data, so awaiting it means waiting for the GPU to catch up completely.

The fix is to accept stale data. Statistics are for display, for scene transitions, and for diagnostics, none of which need to be current to the frame. So you keep a small pool of staging buffers, issue a copy into whichever one is free, and take the result whenever it arrives.

```js
const pool = Array.from({ length: 3 }, () => ({
  buffer: device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  }),
  busy: false,
}));

let latest = null;   // most recent readback, a frame or two old

function requestReadback(encoder, source) {
  const slot = pool.find((s) => !s.busy);
  if (!slot) return;          // all in flight, skip this frame entirely

  slot.busy = true;
  encoder.copyBufferToBuffer(source, 0, slot.buffer, 0, 16);

  // Resolves once the GPU reaches this copy, which is not this frame.
  slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
    latest = new Uint32Array(slot.buffer.getMappedRange()).slice();
    slot.buffer.unmap();
    slot.busy = false;
  }).catch(() => {
    slot.busy = false;         // device lost or buffer destroyed
  });
}
```

Skipping the readback when every slot is busy is the important line. It means the readback rate degrades gracefully under load instead of building an unbounded queue, and the frame loop never waits for anything.

Three slots is a reasonable default, covering the usual one to two frames of latency with a little slack. Reading back once every few frames rather than every frame is also entirely reasonable for a statistic driving a scene transition.

## What not to read back

The rule of thumb is that readback is for values, never for bulk data. Reading a 16 byte counter is cheap. Reading a 3 MB particle buffer every frame defeats the entire architecture, since you have moved the data to the GPU precisely so it does not have to come back.

If you find yourself wanting particle positions on the CPU, the question to ask is whether the decision that needs them could be made on the GPU instead. Usually it can, by computing a summary in the same pass and reading back only that.

There is also `device.queue.onSubmittedWorkDone()`, which resolves when all submitted work has completed. It is useful for teardown and for one off measurements, and it is a stall if you await it in a frame.

## Handling initialisation

Device setup is asynchronous, texture loading is asynchronous, and shader compilation is effectively asynchronous. The frame loop must not start until all of it has finished, and the cleanest structure is a single async initialisation function returning everything the loop needs.

```js
const engine = await init();     // device, pipelines, buffers, textures
requestAnimationFrame(engine.frame);
```

Rendering before an image has been uploaded gives a black texture with no error, which is worth remembering when a first frame looks wrong and every subsequent frame looks right.

## Checkpoint

The particle field with a live GPU computed statistic, read back without stalling and displayed as text. This is the pattern an engine uses to know when a transition has finished.

Start from the [[09_parallel-patterns|parallel patterns]] checkpoint, which already computes a count into a stats buffer with atomics, and make four changes.

Add `GPUBufferUsage.COPY_SRC` to the stats buffer, since a buffer cannot be copied from without it.

```js
const stats = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
});
```

Add the staging pool and the readback function from above, sized 16 bytes to match.

Add an overlay element to the page and a request at the end of the frame, after the compute pass has been recorded.

```html
<div id="hud" style="position:fixed;top:8px;left:8px;font:13px ui-monospace,monospace;color:#9f9;"></div>
```

```js
requestReadback(encoder, stats);
device.queue.submit([encoder.finish()]);

if (latest) {
  const inside = latest[0];
  const sumX = new Int32Array(latest.buffer)[1];
  const sumY = new Int32Array(latest.buffer)[2];
  const cx = inside ? sumX / (4096 * inside) : 0;
  const cy = inside ? sumY / (4096 * inside) : 0;
  hud.textContent =
    `inside ${inside}  (${(100 * inside / COUNT).toFixed(1)}%)\n` +
    `centroid ${cx.toFixed(3)}, ${cy.toFixed(3)}`;
}
```

The count in the HUD should track the green bar drawn by the GPU, lagging it by a frame or two, which is the latency being made visible.

Then produce the stall deliberately, because it is the thing you are learning to avoid. Replace the pooled version with a blocking one inside the frame loop.

```js
device.queue.submit([encoder.finish()]);

// Do not do this.
await staging.mapAsync(GPUMapMode.READ);
const v = new Uint32Array(staging.getMappedRange()).slice();
staging.unmap();
```

The frame rate will drop sharply and unevenly, because every frame now waits for the GPU to finish before the CPU can continue. Watching that happen, and then watching it recover when you restore the pool, is the whole lesson of this note.

One further experiment. Reduce the pool to a single buffer and observe that readbacks now succeed only intermittently, because the sole slot is usually still in flight. The HUD updates less often and the frame rate stays high, which is exactly the intended tradeoff.

## Failure modes

An error that a buffer is already mapped means a slot was reused before its previous mapping resolved, so the busy flag is not being managed correctly.

An error about a detached ArrayBuffer means the mapped range was read after `unmap`, so the `.slice()` is missing.

A validation error about missing `COPY_SRC` or `COPY_DST` means a copy is being attempted between buffers that were not created for it.

A frame rate that is high in isolation but collapses when statistics are enabled means the readback is being awaited synchronously.

Numbers that never update, with no error, usually mean the copy is recorded before the compute pass that produces the data rather than after it.

## Resources

[webgpufundamentals.org, Timing](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html) covers both frame timing and the buffer mapping pattern, and its rolling average helper is directly reusable.

[MDN, GPUBuffer.mapAsync](https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync) documents the state machine a mapped buffer moves through, which is worth reading once because the error messages assume you know it.
