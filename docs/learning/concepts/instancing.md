# Instancing

Running one draw call that renders the same geometry many times, with the shader distinguishing the copies by an index.

```js
pass.draw(4, 100000);
```

That runs the vertex shader four times for each of a hundred thousand instances in a single command. Each invocation receives `@builtin(vertex_index)` telling it which vertex of the shape it is, and `@builtin(instance_index)` telling it which copy.

The alternative, a draw call per object, fails for a reason unrelated to the GPU, since each call carries CPU overhead in validation and command recording. A hundred thousand of them will not fit in a frame regardless of how fast the hardware is.

For small quads, `triangle-strip` topology is worth using, because a quad costs four vertices rather than the six a `triangle-list` needs. The corner order has to zigzag rather than go round the perimeter, since each vertex after the second forms a triangle with the previous two.

Instancing pairs naturally with [[vertex-pulling|vertex pulling]], where the shader looks up per instance data from a storage buffer using the instance index rather than receiving it through vertex attributes.

The cost model is worth remembering. Vertex work scales with the instance count and is usually negligible, while fragment work scales with the total covered area, so radius affects performance far more than count does.

See [[07_instanced-drawing-and-sdf-circles|Instanced drawing and SDF circles]].
