# Clip space

The coordinate system a vertex shader must output, running from -1 to +1 on both axes with the origin at the centre of the target.

The critical detail is that +1 on the y axis is the top, which is the opposite of the DOM convention where y grows downward. Getting it backwards renders a perfectly correct image upside down.

The output type is `vec4f` rather than `vec2f` because the fourth component supports perspective division, which a two dimensional project never uses. Write `vec4f(x, y, 0.0, 1.0)` and the value passes through unchanged.

Converting from pixels is arithmetic you will write repeatedly, and it is worth putting in a helper function.

```wgsl
fn toClip(pixel: vec2f, resolution: vec2f) -> vec4f {
  return vec4f(
     (pixel.x / resolution.x) * 2.0 - 1.0,
    -((pixel.y / resolution.y) * 2.0 - 1.0),
    0.0, 1.0);
}
```

There are three coordinate conventions in play across a WebGPU program, and most early confusion is a mix-up between them. Clip space runs -1 to 1 with y up. Pixel coordinates run 0 to width and height with y down, and are what `@builtin(position)` holds in a fragment shader. Texture coordinates run 0 to 1 with the origin at the top left.

Working in pixels and converting once at the end of the vertex shader is much easier to reason about than working in clip space throughout, particularly because radii and offsets are naturally expressed in pixels.

See [[03_shaders-and-render-pipeline|Shaders and the render pipeline]].
