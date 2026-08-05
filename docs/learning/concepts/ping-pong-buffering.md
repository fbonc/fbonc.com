# Ping-pong buffering

Keeping two buffers or textures and swapping their roles each pass, so that an iterative algorithm never reads the same memory it is writing.

Doing an iteration in place is a data race by construction, because one invocation would read a neighbour's value that another invocation has already overwritten, and there is no ordering between invocations to appeal to.

```js
let src = bufferA, dst = bufferB;

for (let i = 0; i < passes; i++) {
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroups[i % 2]);
  pass.dispatchWorkgroups(groups);
  pass.end();
  [src, dst] = [dst, src];
}
```

Prepare both bind groups once at initialisation and alternate between them rather than creating one per pass.

The reason each iteration is a separate dispatch, rather than a loop inside one shader, is that there is no synchronisation between workgroups within a dispatch. Ending the pass is the only way to guarantee every invocation has finished writing before any invocation starts reading.

The bookkeeping detail worth handling deliberately is that after an odd number of passes the result sits in the buffer you started with, so which of the two holds the final answer depends on the pass count.

The same reasoning applies to storage textures, where the constraint is sharper still, since a compute shader cannot read the storage texture it is writing.

See [[09_parallel-patterns|Parallel patterns]] and [[14_voronoi-and-jump-flooding|Voronoi and jump flooding]].
