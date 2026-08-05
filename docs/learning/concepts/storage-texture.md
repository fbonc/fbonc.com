# Storage texture

A texture a compute shader can write into directly, with `textureStore`.

```wgsl
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

textureStore(dst, vec2i(gid.xy), vec4f(value, value, value, 1.0));
```

The texture needs `STORAGE_BINDING` usage, and two constraints shape how it is used.

The format is part of the type in the shader and must match the texture exactly, so changing one without the other is a validation error. Only a subset of [[texture-formats|formats]] are permitted as storage textures.

In core WebGPU the access mode is write only, so a shader cannot read the storage texture it is writing. Any algorithm that reads a grid and writes the same grid therefore needs two textures and [[ping-pong-buffering|ping-pong]], which is the same conclusion the ordering rules reach from a different direction. A texture also cannot be bound for storage writing and for sampled reading in the same pass.

The alternative way to produce a texture is to render into it, by using it as a render pass attachment rather than the canvas. That path gives you blending and the rasteriser, which storage textures do not have. Use a render target to draw shapes into a grid, and a storage texture to compute a value per cell.

See [[10_textures-and-images|Textures and images]].
