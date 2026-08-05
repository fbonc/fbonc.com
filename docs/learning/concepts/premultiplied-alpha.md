# Premultiplied alpha

A convention in which a colour's RGB components have already been multiplied by its alpha before blending.

```wgsl
let a = colour.a * coverage;
return vec4f(colour.rgb * a, a);
```

```js
blend: {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
}
```

`srcFactor: 'one'` is what makes it premultiplied, since the shader has already applied the alpha and the blend equation must not apply it again. The more familiar unpremultiplied form uses `src-alpha` with `one-minus-src-alpha` and expects raw colour.

Premultiplied is the better default for two reasons. It composes correctly through intermediate render targets, where compositing an already composited layer with the unpremultiplied formula double counts the alpha. And it avoids dark fringes when textures are filtered, because interpolating between an opaque colour and a transparent one under the unpremultiplied convention blends in whatever arbitrary colour the transparent texel happened to store.

Mixing the two conventions produces a specific, recognisable artefact, which is a dark halo around every edge.

Additive blending, with both factors set to `one`, is a one line change from here and gives a glow rather than occlusion, which is often what a dense particle field wants.

Note that blending is not commutative, so with blending enabled the draw order affects the result. For soft translucent dots this is unnoticeable.

See [[07_instanced-drawing-and-sdf-circles|Instanced drawing and SDF circles]].
