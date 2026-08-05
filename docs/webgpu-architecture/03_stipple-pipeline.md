# Stipple pipeline (Voronoi + Lloyd, real time)

Classic weighted CVT stippling: the figure renders in one solid color, and the density of points encodes the image.

Per image, once (CPU + one-shot GPU):

1. Decode image → luminance → density map ρ (dark = dense), uploaded as a texture.
2. **Initial samples**: rejection-sample N points from ρ on the CPU (~ms for 50k, once per image). This is the TargetSet particles first fly to.

Per relaxation tick (GPU, every 2–4 frames):

1. **Seed splat**: render stipple-group particles as 1-px points into an `r32uint` seed texture (particle index), ~1024² offscreen.
2. **JFA**: jump-flood passes (log₂ res ≈ 10 small compute passes) → full Voronoi assignment texture.
3. **Weighted centroids**: compute pass over the texture accumulates ρ·x, ρ·y, ρ per cell via fixed-point `atomicAdd` (WebGPU atomics are u32/i32-only). A finalize pass divides and writes each particle's new target, its cell centroid.
4. The [[02_behaviors|`relax` behavior]] seeks these moving targets slowly. Lloyd relaxation is the visible animation, converging live toward blue-noise spacing.

The module is self-contained (`LloydModule`): input is a particle group plus density texture, output is target updates. Nothing else in the engine knows it exists.
