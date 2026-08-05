# Device and first frame

The shortest complete WebGPU program clears a canvas to a colour. It is worth building carefully, because the objects it introduces are the ones every later note assumes.

## The handshake

Four objects stand between you and the GPU, and you obtain them in a fixed order.

`navigator.gpu` is the entry point, and its absence means no WebGPU. From it you request an [[adapter-device-queue|adapter]], which represents a physical GPU together with a driver. The adapter is where you inspect what the hardware can do, since it advertises optional features and limits before you have committed to anything.

From the adapter you request a device, which is your logical connection to it. The device is the object you actually use, since almost everything is created by calling a method on it. The separation exists so that you can ask the adapter what is available, then ask the device for exactly the subset you want. Anything you do not request is not enabled, even when the hardware supports it, which keeps behaviour consistent across machines.

The device owns a single queue, reachable as `device.queue`. It is the only path to actually executing work.

```js
if (!navigator.gpu) throw new Error('WebGPU not supported');

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('no adapter available');

const device = await adapter.requestDevice();
```

Both requests are asynchronous, so device setup is inherently `async` and everything downstream has to be sequenced after it. That single fact tends to shape the initialisation code of an entire engine.

Requesting optional capabilities happens here and nowhere else.

```js
const device = await adapter.requestDevice({
  requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  requiredLimits: { maxStorageBufferBindingSize: 256 * 1024 * 1024 },
});
```

A `requiredLimits` entry that the adapter cannot satisfy rejects the request rather than quietly giving you less, which is the behaviour you want. Ask only for what you will use.

## Connecting a canvas

A device by itself has nowhere to draw. You obtain a WebGPU context from a canvas element and configure it, which sets up the [[swapchain|swapchain]], the small rotating set of textures the browser hands you to draw into and then displays.

```js
const canvas = document.querySelector('canvas');
const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();

context.configure({ device, format, alphaMode: 'opaque' });
```

Always take the format from `getPreferredCanvasFormat()` rather than hardcoding one. It returns whichever of `bgra8unorm` or `rgba8unorm` the platform composites fastest, and using the other costs a conversion on every frame. The value matters again later, because a render pipeline has to declare the same format it will be drawing into.

`alphaMode` decides how the canvas composites against the page behind it. Use `opaque` unless you actually want the page to show through the canvas, in which case `premultiplied` is the other option and it interacts with how you write alpha in your fragment shader. This project draws on a solid background, so `opaque` is correct and cheaper.

## Sizing, and device pixel ratio

Canvas sizing catches everyone once. The CSS size and the backing store size are different things, and only the second one affects how many pixels you actually render.

```js
const dpr = Math.min(window.devicePixelRatio, 2);
canvas.width  = Math.floor(canvas.clientWidth  * dpr);
canvas.height = Math.floor(canvas.clientHeight * dpr);
```

Setting `canvas.width` without accounting for [[device-pixel-ratio|device pixel ratio]] gives a blurry result on any high density display, and setting it to the full ratio on a 3x phone means rendering nine times the pixels for a barely visible gain, so clamping to 2 is a common compromise. The robust way to track this is a `ResizeObserver`, which reports the true backing size directly.

You do not need to call `configure()` again after a resize. The context reallocates its textures to match the canvas, so simply assigning `canvas.width` and `canvas.height` is enough.

## Encoders, passes, and submission

Nothing so far draws. Work reaches the GPU through a [[command-encoder|command encoder]], which records commands into an opaque list.

Inside an encoder you open passes. A render pass is a scope that declares which textures it draws into and what should happen to them at the start and end. Every draw call lives inside one.

```js
const encoder = device.createCommandEncoder();

const pass = encoder.beginRenderPass({
  colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
    loadOp: 'clear',
    storeOp: 'store',
  }],
});

pass.end();
device.queue.submit([encoder.finish()]);
```

`loadOp` says what to do with the attachment's existing contents when the pass begins. Choosing `clear` fills it with `clearValue`, and choosing `load` preserves what was there. `storeOp` says whether the results are kept, with `store` meaning yes and `discard` meaning the contents are not needed afterwards. These are not cosmetic. On tile based GPUs, which includes every phone and Apple silicon Mac, clearing rather than loading avoids reading the previous frame's pixels from memory at all, and it is a genuine bandwidth saving.

Note that this pass ends without a single draw call, and it still does something, because the clear itself is the work.

Call `context.getCurrentTexture()` fresh every frame and do not cache the result. It hands you the next texture in the swapchain rotation, and the one you got last frame is very likely already on screen.

`encoder.finish()` closes the recording and returns a command buffer, and `queue.submit()` hands it over. Both the encoder and the command buffer are single use, so a frame creates new ones each time. This is expected and cheap.

## Handling device loss

A GPU device can be lost, through driver crashes, hardware sleep, or the browser reclaiming resources from a background tab. Anything long lived should at least notice.

```js
device.lost.then((info) => {
  console.error('device lost:', info.reason, info.message);
});
```

A lost device cannot be repaired, and recovery means requesting a new adapter and device and rebuilding everything. That is out of scope for now, but a silent black canvas with no console output is a miserable thing to debug, so wire up the log on day one.

## Checkpoint

A canvas that clears to an animated colour, correctly sized for the display.

```html
<!doctype html>
<meta charset="utf-8">
<title>Clear</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
<canvas></canvas>
<script type="module">
const canvas = document.querySelector('canvas');

if (!navigator.gpu) throw new Error('WebGPU not supported');
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('no adapter available');
const device = await adapter.requestDevice();

device.lost.then((info) => console.error('device lost:', info.reason, info.message));

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

const observer = new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = entry.contentBoxSize[0].inlineSize * dpr;
  const h = entry.contentBoxSize[0].blockSize * dpr;
  canvas.width  = Math.max(1, Math.min(w | 0, device.limits.maxTextureDimension2D));
  canvas.height = Math.max(1, Math.min(h | 0, device.limits.maxTextureDimension2D));
});
observer.observe(canvas);

function frame(timeMs) {
  const t = timeMs / 1000;

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: {
        r: 0.5 + 0.5 * Math.sin(t),
        g: 0.5 + 0.5 * Math.sin(t + 2.09),
        b: 0.5 + 0.5 * Math.sin(t + 4.19),
        a: 1,
      },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.end();
  device.queue.submit([encoder.finish()]);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

The canvas should cycle smoothly through hues, fill the window, and stay sharp when you resize it.

Try one experiment before moving on. Change `loadOp` to `'load'` and observe that the animation continues anyway, because the clear value is simply ignored and each frame draws nothing over an untouched texture. What you are seeing is the swapchain rotating between two or three textures that still hold old frames, which is a useful early demonstration that you do not own the texture you draw into.

## Failure modes

A blank canvas with no errors usually means zero size. If `clientWidth` is read before layout, or the CSS gives the canvas no height, the backing store ends up 0 by 0 and everything silently does nothing.

An error about the canvas texture being destroyed means the result of `getCurrentTexture()` was cached across frames.

If the page is sharp on a normal monitor but blurry on a laptop display, the device pixel ratio is not being applied.

## Resources

[webgpufundamentals.org, Fundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html) builds the same first program.

[webgpufundamentals.org, Canvas resizing](https://webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html) is short and worth reading for the details of `ResizeObserver` and device pixel ratio.
