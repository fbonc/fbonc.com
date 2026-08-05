# Workgroup

A fixed size block of compute invocations scheduled together on one compute unit, able to share memory and to synchronise with each other.

The size is declared in the shader, and the product of its dimensions must not exceed `maxComputeInvocationsPerWorkgroup`, which is 256 on essentially all hardware.

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) { ... }
```

Use 64 for work over a one dimensional array, and 8 by 8 for work over a grid so that neighbouring invocations touch neighbouring memory. The reason to prefer multiples of 32 is that hardware executes invocations in lockstep groups of 32 or 64, so a smaller size wastes lanes outright, while a very large size reduces how many workgroups can be resident and therefore how well memory latency is hidden.

The related builtins are `global_invocation_id` for the index within the whole dispatch, `local_invocation_id` within the workgroup, `workgroup_id` for which workgroup this is, and `local_invocation_index` as the flattened local index, which is the convenient one for indexing workgroup memory.

There is no synchronisation between workgroups, only within one. That single fact is why multi pass algorithms are structured as separate dispatches.

The size is baked into the compiled shader, which is what `override` constants exist to work around.

See [[08_compute-shaders|Compute shaders]], [[dispatch-math|dispatch math]] and [[workgroup-barrier|workgroup barrier]].
