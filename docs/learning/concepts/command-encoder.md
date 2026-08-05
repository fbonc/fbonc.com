# Command encoder

The object that records GPU commands into a list, which is then submitted to the queue.

Nothing you call on an encoder executes immediately. You create an encoder, open passes on it, record work inside those passes, call `encoder.finish()` to produce a command buffer, and hand that buffer to `device.queue.submit()`. The GPU works through it whenever it gets there, which is why errors surface asynchronously and why timing a submit call measures nothing useful.

Both the encoder and the command buffer it produces are single use, so a frame creates new ones each time. This is expected and cheap, unlike creating pipelines or bind groups.

Passes come in two kinds. A render pass declares its colour attachments along with a `loadOp` and `storeOp` for each, and contains draw calls. A compute pass has no attachments and contains dispatches. Both are closed with `end()`.

The encoder also carries operations that sit outside any pass, notably `copyBufferToBuffer`, `copyTextureToTexture`, `clearBuffer`, and `resolveQuerySet`.

Ordering between passes recorded on the same encoder is guaranteed, and WebGPU inserts whatever synchronisation the hardware needs between a pass that writes a resource and a later pass that reads it. There is no ordering within a pass between separate invocations, which is why iterative algorithms use [[ping-pong-buffering|ping-pong]] across passes.

One encoder and one submit per frame is a sensible default.

See [[02_device-and-first-frame|Device and first frame]] and [[11_frame-loop-and-readback|Frame loop and readback]].
