# Dispatch math

`dispatchWorkgroups` counts workgroups, not invocations, so the item count is divided by the [[workgroup|workgroup size]] and rounded up.

```js
pass.dispatchWorkgroups(Math.ceil(count / 64));
```

Rounding up means you almost always launch more invocations than you have items. With 100000 items at a workgroup size of 64 you get 1563 workgroups and therefore 100032 invocations, so 32 of them have no work to do.

Those extras must be stopped, and the guard goes first in the shader body.

```wgsl
let i = gid.x;
if (i >= params.count) { return; }
```

Omitting it does not crash, because WebGPU clamps or discards out of bounds access, so instead several invocations end up writing to the last valid element and the result is silently wrong.

For grid shaped work the dispatch and the guard are both two dimensional.

```js
pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
```

Each dimension is capped at `maxComputeWorkgroupsPerDimension`, typically 65535, which is large but not unlimited.

An early `return` interacts badly with [[workgroup-barrier|barriers]], so a shader that both guards and synchronises has to guard by branching around the work rather than returning.

See [[08_compute-shaders|Compute shaders]].
