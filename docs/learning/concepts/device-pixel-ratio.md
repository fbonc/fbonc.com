# Device pixel ratio

The number of physical display pixels per CSS pixel, exposed as `window.devicePixelRatio`.

A canvas has two independent sizes. Its CSS size controls how large it appears on the page, and its `width` and `height` attributes control how many pixels are actually rendered. Setting only the first gives a blurry result on any high density display, because a smaller image is being stretched.

```js
const dpr = Math.min(window.devicePixelRatio, 2);
canvas.width  = Math.floor(canvas.clientWidth  * dpr);
canvas.height = Math.floor(canvas.clientHeight * dpr);
```

Clamping to 2 is a common compromise, since a 3x phone display would otherwise render nine times the pixels for a barely perceptible gain, and fragment cost scales directly with pixel count.

`ResizeObserver` is more reliable than a resize event plus `clientWidth`, since it reports the true backing size and fires when layout actually changes rather than only when the window does.

The ratio also has to be applied to anything expressed in CSS pixels before it reaches a shader, which includes pointer coordinates and particle radii. Mixing the two units is a common source of shapes that are the right size on one machine and wrong on another.

Assigning `canvas.width` reallocates the [[swapchain|swapchain]] automatically, so `context.configure()` need not be called again.

See [[02_device-and-first-frame|Device and first frame]].
