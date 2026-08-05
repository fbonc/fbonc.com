# Vertex pulling

Having the vertex shader read its data from a storage buffer using a builtin index, instead of receiving it through declared vertex attributes.

```wgsl
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
  let p = particles[i];
  ...
}
```

There is no vertex buffer, no attribute layout in the pipeline descriptor, and no geometry uploaded per frame.

For a particle engine this is not a stylistic preference over the classic arrangement, it is the only one that works. A compute shader writes the same buffer as `read_write`, and the renderer reads it as `read` on the next pass, so the data never moves and the CPU never sees it. A vertex buffer with a declared attribute layout would impose a second fixed interpretation on the same memory and buy nothing.

It composes with [[instancing|instancing]], where the instance index selects the object and the vertex index selects the corner of its geometry, and the geometry itself is usually a small constant array in the shader.

See [[07_instanced-drawing-and-sdf-circles|Instanced drawing and SDF circles]].
