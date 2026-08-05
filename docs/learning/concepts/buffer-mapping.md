# Buffer mapping

The only route from GPU memory back to JavaScript, and it is asynchronous by nature.

Because `MAP_READ` cannot be combined with `STORAGE`, the buffer a shader writes is never the buffer you read. You keep a separate staging buffer, copy into it with `encoder.copyBufferToBuffer`, then map the staging buffer.

```js
await staging.mapAsync(GPUMapMode.READ);
const values = new Uint32Array(staging.getMappedRange()).slice();
staging.unmap();
```

The `.slice()` is required rather than stylistic. `getMappedRange()` returns a view into memory that is invalidated by `unmap()`, so the values have to be copied out while the mapping is live.

A mapped buffer is unusable by the GPU until unmapped, and a buffer that is already mapped or has a mapping pending cannot be mapped again, which is what forces a pool of staging buffers rather than a single one.

The performance trap is that `mapAsync` cannot resolve until the GPU has finished the work that produced the data, so awaiting it inside the frame loop drains the pipeline and collapses the frame rate. The fix is to accept data that is a frame or two stale, issuing the copy into whichever pooled buffer is free and skipping the readback entirely when all of them are in flight.

Read values, never bulk data. A 16 byte counter is cheap and a multi megabyte particle buffer defeats the point of putting the data on the GPU.

See [[11_frame-loop-and-readback|Frame loop and readback]].
