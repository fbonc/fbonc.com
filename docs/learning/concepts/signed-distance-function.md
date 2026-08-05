# Signed distance function

A function returning the distance from a point to a shape's surface, negative inside the shape and positive outside.

For a circle it is as simple as a function gets.

```wgsl
fn sdCircle(p: vec2f, r: f32) -> f32 {
  return length(p) - r;
}
```

The value is useful beyond a yes or no test. Because it is a continuous distance rather than a boolean, it can be fed to [[smoothstep|smoothstep]] to produce an antialiased edge, offset to grow or shrink the shape, or thresholded twice to produce an outline. That is why particles are drawn as a quad shaped by an SDF in the fragment shader rather than as actual circular geometry.

The technique generalises. Inigo Quilez catalogues dozens of two dimensional distance functions, along with operations that combine them, so rounded rectangles, stars, and arbitrary unions come from the same machinery at the same cost.

A useful property is that when a quad's interpolated local coordinate runs from -1 to 1, the distance from its centre is simply `length(local)` and the edge sits at 1, so no extra data needs to be passed between the stages.

See [[07_instanced-drawing-and-sdf-circles|Instanced drawing and SDF circles]] and [Inigo Quilez, 2D distance functions](https://iquilezles.org/articles/distfunctions2d/).
