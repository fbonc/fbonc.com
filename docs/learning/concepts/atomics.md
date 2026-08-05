# Atomics

An operation that reads, modifies, and writes a memory location as a single indivisible step, so that concurrent updates from many invocations cannot interleave and lose each other.

They are the only sanctioned way for more than one invocation to write the same location. Without them the result of concurrent writes is genuinely undefined, differing between machines and between runs.

WGSL provides `atomicLoad`, `atomicStore`, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicExchange` and `atomicCompareExchangeWeak`.

The constraints are tight. They work only on `atomic<u32>` and `atomic<i32>`, only in the `storage` address space with `read_write` access or in `workgroup` memory. There are no floating point atomics, which is what forces [[fixed-point-accumulation|fixed point accumulation]]. An atomic variable cannot be read with an ordinary expression, so `atomicLoad` is required even to look at one.

The same buffer may be declared with `atomic<u32>` in a shader that updates it and plain `u32` in a shader that only reads it during a pass where nothing writes. A buffer is only bytes, and the atomic wrapper describes intent to access rather than a property of the memory.

Two operational points. Accumulators accumulate, so they must be reset between frames, and `encoder.clearBuffer(buffer)` is the cheapest way. And contention is real, since many invocations hitting one address serialise, which is what a two level reduction through [[workgroup|workgroup memory]] exists to avoid.

See [[09_parallel-patterns|Parallel patterns]].
