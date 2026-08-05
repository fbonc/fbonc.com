# Buffer usage flags

A bitmask declared once at buffer creation that fixes what the buffer is permitted to do for its entire life.

The ones that come up are `UNIFORM` for a uniform binding, `STORAGE` for a storage binding, `COPY_DST` to be written by `writeBuffer` or to be the destination of a copy, `COPY_SRC` to be the source of a copy, `MAP_READ` to be mapped for reading, `INDIRECT` for indirect draw and dispatch arguments, and `QUERY_RESOLVE` to receive resolved timestamp queries.

Declare exactly what you need. Some combinations are illegal, and the important one is that `MAP_READ` cannot be combined with `STORAGE`. That single restriction is the reason readback requires a separate staging buffer rather than mapping the buffer your shader wrote, and it is the origin of the whole copy then map pattern.

Missing a flag produces a clear validation error naming the buffer, provided the buffer has a `label`, which is the strongest practical argument for labelling everything.

See [[gpubuffer|GPUBuffer]] and [[11_frame-loop-and-readback|Frame loop and readback]].
