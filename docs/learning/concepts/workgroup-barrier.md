# Workgroup barrier

`workgroupBarrier()` makes every invocation in a [[workgroup|workgroup]] wait until all of them have reached that point, and makes their writes to workgroup memory visible to each other.

It is the only synchronisation available inside a dispatch. There is nothing equivalent between workgroups, which is why algorithms that need global synchronisation use separate passes.

The rule that catches people is that a barrier must be reached by every invocation in the workgroup, so it can never sit inside a branch that only some of them take, and it can never follow an early `return` that only some of them execute. A shader that both bounds checks and synchronises has to branch around the work rather than returning from it.

```wgsl
var<workgroup> partial: array<u32, 64>;

partial[lid] = select(0u, 1u, gid.x < count && predicate(gid.x));
workgroupBarrier();

var stride = 32u;
while (stride > 0u) {
  if (lid < stride) { partial[lid] = partial[lid] + partial[lid + stride]; }
  workgroupBarrier();
  stride = stride / 2u;
}
```

Note that the barrier inside the loop sits outside the `if`, and that the loop bound is uniform across the workgroup so every invocation runs the same number of iterations.

Violating the requirement can produce a hang, a lost device, or a validation error about uniform control flow, depending on the implementation.

There is also `storageBarrier()`, which orders accesses to storage memory within a workgroup, and it is needed far less often.

See [[09_parallel-patterns|Parallel patterns]].
