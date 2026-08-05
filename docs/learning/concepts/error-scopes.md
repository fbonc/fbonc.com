# Error scopes

The mechanism for attributing a WebGPU error to the code that caused it, rather than merely seeing it in the console.

```js
device.pushErrorScope('validation');
const pipeline = device.createRenderPipeline({ ... });
device.popErrorScope().then((error) => {
  if (error) console.error('pipeline creation failed:', error.message);
});
```

Scopes nest, and the innermost matching one captures the error. The three filters are `validation` for API misuse, `out-of-memory` for allocation failure, and `internal` for driver problems.

Uncaptured errors go to the console by default, and adding an `uncapturederror` listener makes them impossible to miss. Wrapping the whole of initialisation in a validation scope is cheap and worthwhile. Wrapping every frame is a development build convenience, since popping a scope forces a small amount of synchronisation.

Shader compilation errors do not arrive through this mechanism at all. They come from `shaderModule.getCompilationInfo()`, which reports line and column, and wiring it up from the first shader onward is the difference between a five second fix and a blank screen.

Labels multiply the value of all of this, since an unlabelled object produces an error message that names nothing.

See [[12_debugging-and-performance|Debugging and performance]].
