# Sampler

An object describing how a texture read is filtered and how out of range coordinates are handled. It is separate from the texture, so one sampler can serve many textures.

```js
const sampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
});
```

`linear` filtering blends between neighbouring texels, which is what makes reading at a fractional coordinate smooth, and it is free because dedicated hardware does it. `nearest` returns the single closest texel and is what you want when the texture holds data rather than an image, since interpolating between two seed indices produces a meaningless third value.

Address modes decide what happens outside the 0 to 1 range, with `clamp-to-edge`, `repeat`, and `mirror-repeat` available. Handling edges here rather than with a bounds check in the shader is one of the reasons to use a texture at all.

Samplers are used only by `textureSample`, which exists only in fragment shaders because filtering needs the derivative information the rasteriser provides. Compute shaders read with `textureLoad`, which takes integer coordinates, does no filtering, and needs no sampler.

See [[10_textures-and-images|Textures and images]].
