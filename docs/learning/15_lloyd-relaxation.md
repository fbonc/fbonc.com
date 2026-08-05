# Lloyd relaxation

[[13_density-and-rejection-sampling|Rejection sampling]] gives points with the right density and the wrong texture, clumped and gappy. [[14_voronoi-and-jump-flooding|Jump flooding]] gives a cell labelling for a set of seeds. Lloyd relaxation is the algorithm that combines them into an even, organic distribution, and it is the heart of weighted Voronoi stippling.

## Centroidal Voronoi tessellation

A [[centroidal-voronoi-tessellation|centroidal Voronoi tessellation]] is a Voronoi diagram with a special property, which is that every seed sits exactly at the centre of mass of its own cell.

That is a fixed point condition rather than a construction. Ordinarily a seed is somewhere inside its cell but not at its centroid, and the two coincide only for particular arrangements. Those arrangements are precisely the ones that look good, because a seed at its cell's centroid means every cell is balanced around its own site, which forces the seeds into an even, locally hexagonal packing with no clumps and no gaps.

Weighting is what makes it useful for images. If the centre of mass is computed with a density weight, so that dark pixels count for more, cells in dark regions shrink and cells in light regions grow. The seeds end up densely packed where the image is dark and spread out where it is light, and the spacing is locally even everywhere. That is exactly what stippling wants.

## The algorithm

Lloyd's algorithm finds a centroidal tessellation by iteration, and it is three steps repeated.

Compute the Voronoi diagram of the current seeds. Compute the weighted centroid of each cell. Move each seed to its centroid. Repeat.

That is the whole thing. It is a fixed point iteration, it converges reliably in practice, and each iteration makes the distribution more even than the last. Twenty iterations is usually enough to look good, and the first five make most of the visible difference.

The centroid of a cell, weighted by density `ρ`, is the density weighted average position of the points in it.

```
centroid = Σ ρ(p) · p  /  Σ ρ(p)
```

On a grid, the sums run over the pixels the cell owns. Both the numerator and the denominator are accumulations over an unpredictable set of pixels, which is exactly the scatter with collisions pattern.

## Why it belongs on the GPU

Each iteration touches every pixel of the grid, so twenty iterations of a 512 by 512 grid is five million pixel visits, and the classic use is to run it offline and save the result.

Running it per frame instead turns it into an animation, where the points visibly migrate from a clumped scatter into an even field, and that is worth far more than the static result. One iteration per frame is cheap, and after a second or two the image has resolved. The convergence is the effect.

## The GPU pipeline

Four passes per iteration, and each one is a pattern from earlier notes.

The jump flooding passes label every pixel with its owning seed, exactly as before, which is ping-pong over textures.

The accumulation pass runs one invocation per pixel. Each reads its cell index from the labelling, reads its density from the source, and atomically adds its weighted position into that cell's accumulator. This is scatter with collisions, and it is where [[fixed-point-accumulation|fixed point atomics]] are required, because WGSL has no float atomics.

```wgsl
let cell = textureLoad(labels, coord, 0).z;
let w = textureLoad(densityTex, coord, 0).r;

let n = vec2f(coord) / f32(params.size);          // normalise before scaling

atomicAdd(&cells[cell].sumX, i32(n.x * w * SCALE));
atomicAdd(&cells[cell].sumY, i32(n.y * w * SCALE));
atomicAdd(&cells[cell].sumW, i32(w * SCALE));
```

The update pass runs one invocation per seed. Each divides its sums to get the centroid and moves toward it.

```wgsl
let sw = f32(atomicLoad(&cells[i].sumW));
if (sw <= 0.0) { return; }                        // empty cell, leave the seed alone

let centroid = vec2f(f32(atomicLoad(&cells[i].sumX)),
                     f32(atomicLoad(&cells[i].sumY))) / sw * f32(params.size);

seeds[i] = mix(seeds[i], centroid, params.rate);
```

And the accumulators must be cleared before each iteration, with `encoder.clearBuffer(cellBuffer)`, since atomics accumulate.

## Three details that matter

Moving all the way to the centroid each frame, with `rate` at 1.0, converges fastest and looks like a twitch. Interpolating part of the way, with a rate around 0.15, converges nearly as fast in wall clock terms and produces a smooth, organic migration. That is the animation, and the rate is the main aesthetic control.

Empty cells have to be handled explicitly. A cell can own no pixels at all, which happens when two seeds land on the same pixel or when a seed sits in a region of zero density. Dividing by zero gives a position of NaN, and a NaN seed poisons the jump flooding for every pixel that reaches it, so a single unguarded division can destroy the entire image. Check the weight sum before dividing.

The scale factor needs the same overflow arithmetic as always. With normalised coordinates the largest possible sum for one cell is the pixel count of the grid times the scale, so a 512 by 512 grid with a scale of 4096 gives about 1.07 billion in the worst case where one cell owns everything, which fits inside `i32` with room to spare. Raise the grid to 1024 and that worst case overflows, so either lower the scale or accumulate in a different unit.

## What convergence looks like

The seeds move quickly for the first few iterations and then slow markedly. The clumps break apart first, then gaps fill, then the whole field settles into a locally hexagonal packing, which is the arrangement that minimises the energy Lloyd's algorithm is descending.

It does not converge to a unique answer. Different starting points give different final arrangements, all of them good, which is why the initial rejection sampling does not need to be high quality. It only needs the right density and enough randomness to avoid a degenerate start.

There is one visible artefact worth expecting, which is that regions of exactly zero density leave their seeds stranded, since a cell with no weight has no centroid to move toward. Clamping the density to a small positive minimum, as [[13_density-and-rejection-sampling|the sampling note]] suggests, keeps every seed engaged and is worth doing.

## Checkpoint

Extend the jump flooding checkpoint into live weighted relaxation. Start from that file and make five changes, each of which is a pattern you already know.

Replace the drifting seeds with points from rejection sampling. Build the density map on a Canvas2D source exactly as in the sampling note, keep the `Float32Array` of densities, and sample the initial seed positions from it. Upload the density to an `r32float` texture so the accumulation pass can read it.

```js
const densityTex = device.createTexture({
  label: 'density',
  size: [N, N],
  format: 'r32float',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});

device.queue.writeTexture(
  { texture: densityTex },
  density,                       // Float32Array, N * N
  { bytesPerRow: N * 4 },
  [N, N],
);
```

Add a cell accumulator buffer, four `i32` per seed, and give it `COPY_DST` so it can be cleared.

```js
const cells = device.createBuffer({
  label: 'cells',
  size: SEEDS * 16,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
```

Add the accumulation shader, one invocation per pixel.

```wgsl
struct Cell {
  sumX: atomic<i32>,
  sumY: atomic<i32>,
  sumW: atomic<i32>,
  count: atomic<u32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var labels: texture_2d<u32>;
@group(0) @binding(2) var densityTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> cells: array<Cell>;

const SCALE: f32 = 4096.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.size || gid.y >= params.size) { return; }

  let c = vec2i(gid.xy);
  let label = textureLoad(labels, c, 0);
  if (label.w == 0u) { return; }

  let w = max(textureLoad(densityTex, c, 0).r, 0.002);
  let n = vec2f(gid.xy) / f32(params.size);

  let i = label.z;
  atomicAdd(&cells[i].sumX, i32(n.x * w * SCALE));
  atomicAdd(&cells[i].sumY, i32(n.y * w * SCALE));
  atomicAdd(&cells[i].sumW, i32(w * SCALE));
  atomicAdd(&cells[i].count, 1u);
}
```

Replace the seed movement shader with the centroid update, one invocation per seed.

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.seedCount) { return; }

  let sw = f32(atomicLoad(&cells[i].sumW));
  if (sw <= 0.0) { return; }

  let centroid = vec2f(f32(atomicLoad(&cells[i].sumX)),
                       f32(atomicLoad(&cells[i].sumY))) / sw * f32(params.size);

  var s = seeds[i];
  s = vec4f(mix(s.xy, centroid, 0.15), s.zw);
  seeds[i] = s;
}
```

Finally, order the frame correctly and clear the accumulators.

```js
const encoder = device.createCommandEncoder();

encoder.clearBuffer(cells);

// 1. clear the grid and stamp the seeds
// 2. the jump flooding passes
// 3. accumulate weighted centroids per cell
// 4. move each seed toward its centroid
// 5. render

device.queue.submit([encoder.finish()]);
```

The clear must come before the accumulation and the accumulation must come after the labelling, and getting either backwards produces a specific, recognisable failure listed below.

What you should see is the payoff for the whole of Part IV. The seeds start as the clumped scatter from rejection sampling, and over about two seconds they visibly spread apart, break up their clusters, fill their gaps, and settle into an even field that follows the image. Cells are small and dense in the dark regions and large in the light ones. Rendering the seeds as small dots on white, rather than the coloured cells, gives you the stipple drawing.

Five experiments, and the first is the important one. Render the same points before and after relaxation and compare the even grey regions directly, because the difference between white noise and something close to blue noise is much more obvious side by side than described. Set the mix rate to 1.0 and watch it snap rather than flow. Set it to 0.02 and watch it crawl. Remove the `sw <= 0.0` guard and add a region of pure white to the source image, then watch a NaN seed corrupt an expanding wedge of the diagram. Finally raise `SCALE` to 65536 and watch cells in dense regions fly apart as their accumulators overflow.

## Failure modes

Seeds that jump to a corner or vanish are NaN, from dividing by a zero weight sum.

Seeds that drift steadily in one direction usually mean the accumulators are not being cleared, so each frame adds to the last.

Seeds that do not move at all mean the accumulation pass is reading the wrong ping-pong texture, so every cell index is zero or invalid.

A distribution that becomes even but ignores the image means the density weight is not being applied, so you are computing an unweighted centroidal tessellation, which is a correct algorithm solving the wrong problem.

Cells in dense regions behaving erratically while sparse regions are fine is the signature of fixed point overflow.

## Resources

Adrian Secord, [Weighted Voronoi Stippling](https://www.cs.ubc.ca/labs/imager/tr/2002/secord2002b/secord.2002b.pdf), 2002, is the paper this note describes, and it is worth reading in full since it is six pages and covers the entire pipeline.

Qiang Du, Vance Faber and Max Gunzburger, [Centroidal Voronoi Tessellations: Applications and Algorithms](https://epubs.siam.org/doi/10.1137/S0036144599352836), 1999, is the mathematical treatment, including the energy function Lloyd's algorithm minimises and the convergence proofs.

Stuart Lloyd's original 1957 work at Bell Labs, published in 1982 as Least Squares Quantization in PCM, is where the algorithm comes from, and the fact that it was invented for signal quantisation rather than graphics is a useful reminder of how general it is.
