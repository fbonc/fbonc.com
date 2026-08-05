# GPUBuffer

A flat, untyped block of GPU memory with a size in bytes and a set of [[buffer-usage-flags|usage flags]].

There is no element type, no length, and no structure. All meaning comes from how a shader chooses to interpret the bytes, which is why the CPU and GPU can disagree about layout without any error being raised, and why [[06_memory-layout-and-alignment|alignment]] deserves its own note.

Sizes must be a multiple of 4, and in practice should be rounded up further to match struct alignment.

Data gets in by one of two routes. `device.queue.writeBuffer(buffer, offset, data)` copies from a typed array and is the right choice for anything written repeatedly, and it snapshots your array during the call so you may reuse it immediately. Creating the buffer with `mappedAtCreation: true` and writing into `getMappedRange()` avoids an intermediate copy and is the right choice for data uploaded exactly once, and notably does not require `COPY_DST`.

Data gets out only through [[buffer-mapping|mapping]], which is asynchronous and needs a separate staging buffer.

The distinction that matters most in shaders is between a uniform binding, which is small, read only, and identical across invocations, and a storage binding, which is large and can be written. If there is one of it, make it uniform. If there are a hundred thousand of them, make it storage.

See [[04_buffers-and-bind-groups|Buffers and bind groups]].
