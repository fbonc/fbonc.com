# Voronoi and jump flooding

Given a set of seed points, the Voronoi diagram assigns every location in the plane to its nearest seed. The regions that result are called cells, and the diagram is one of the most reused structures in computational geometry.

This note is about computing one on a grid, quickly, every frame, which is a different problem from computing one exactly.

## The diagram

Formally, the cell belonging to seed `i` is the set of points closer to `i` than to any other seed. The cells are convex polygons, their boundaries lie on the perpendicular bisectors between pairs of seeds, and together they tile the plane.

The exact construction is a solved problem, with Fortune's sweepline algorithm producing the true polygonal diagram in `O(n log n)`. It gives you edges, vertices, and adjacency, and it is the right tool when you need the geometry itself.

You do not need the geometry. You need to know, for each pixel, which seed owns it, so that you can accumulate something per cell. That is a discrete labelling of a grid rather than a polygonal structure, and it admits a completely different and much more parallel approach.

## The brute force baseline

The obvious method is to have every pixel test every seed.

```wgsl
var best = 0u;
var bestDist = 1e30;
for (var i = 0u; i < seedCount; i++) {
  let d = distance(pixel, seeds[i]);
  if (d < bestDist) { bestDist = d; best = i; }
}
```

It is trivially parallel, exactly correct, and costs `pixels * seeds`. At 512 by 512 with 20000 seeds that is five billion distance computations per frame, which is far too slow. The cost is linear in the seed count, and the seed count is exactly the thing you want to be large.

## Jump flooding

[[jump-flooding|Jump flooding]] computes an approximate Voronoi labelling in a number of passes that depends only on the grid size, not on the seed count. For a 512 by 512 grid it is nine passes regardless of whether there are ten seeds or fifty thousand.

The structure is an information propagation. Each texel stores the coordinate of the nearest seed it currently knows about, which starts as unknown everywhere except at the seeds themselves. Then a sequence of passes spreads that knowledge outward at decreasing distances.

In each pass, with step size `k`, every texel looks at nine locations, itself and its eight neighbours at offsets of `k` in each direction. For every one of those that holds a seed, it computes the distance from itself to that seed, and keeps whichever is nearest.

The step sizes halve each pass, starting at half the grid width and ending at 1.

```
pass 0: k = 256
pass 1: k = 128
...
pass 8: k = 1
```

The reason it works is that any two locations on the grid can be connected by a sequence of jumps of decreasing powers of two, which is the binary representation of the distance between them. So after all passes, every texel has had the opportunity to receive information from every seed. The propagation is logarithmic in the grid width, and the total cost is `pixels * log(width)`, entirely independent of the number of seeds.

Nine passes over 262144 texels, each doing nine distance computations, is about 21 million operations, against five billion for brute force. That is the whole reason the technique exists.

## Approximate, and why it is fine

Jump flooding does not always produce the exact answer. A texel can end up assigned to a seed that is not quite the nearest, because the correct seed's information happened not to reach it along any of the jump paths.

The error rate is very low, typically well under one texel in ten thousand, and the errors are geometrically tiny, meaning a misassigned pixel sits right on a cell boundary where the two seeds are nearly equidistant. For rendering, and for accumulating centroids, this is invisible.

Two standard variants reduce it further at the cost of one extra pass. Appending a final pass with `k = 1` is called JFA+1 and cleans up local boundary errors. Prepending a pass with `k = 1` is called 1+JFA. Either is a one line change, and neither is necessary unless you actually observe artefacts.

## Encoding the state

Each texel must store which seed it currently believes is nearest. Storing the seed's coordinates is the usual choice, since the distance can then be recomputed cheaply and no lookup into a seed array is needed.

For this project the seed's index is needed as well, because the next step accumulates values per cell. So a texel holds a coordinate pair, an index, and a validity flag.

```wgsl
// rgba32uint: x = seed x, y = seed y, z = seed index, w = 1 if valid
@group(0) @binding(1) var src: texture_2d<u32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32uint, write>;
```

Integer coordinates are exact and avoid any question of floating point comparison. An alternative is `rgba32float` storing the seed position directly, which matters if seeds live at fractional positions, and it is worth noting that they do after relaxation moves them. Storing the index and looking the exact position up in the seed buffer sidesteps that entirely, and is what the [[15_lloyd-relaxation|next note]] relies on.

The validity flag is necessary because at the start almost every texel knows nothing, and a texel with no seed must not be mistaken for a texel whose nearest seed happens to sit at the origin.

## The pass

```wgsl
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let here = vec2f(gid.xy);
  let k = i32(params.step);

  var best = vec4u(0u, 0u, 0u, 0u);
  var bestDist = 1e30;

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = vec2i(gid.xy) + vec2i(dx, dy) * k;
      if (c.x < 0 || c.y < 0 || c.x >= i32(dims.x) || c.y >= i32(dims.y)) { continue; }

      let s = textureLoad(src, c, 0);
      if (s.w == 0u) { continue; }

      let d = distance(here, vec2f(f32(s.x), f32(s.y)));
      if (d < bestDist) { bestDist = d; best = s; }
    }
  }

  textureStore(dst, vec2i(gid.xy), best);
}
```

Note that the loop reads only from `src` and writes only to `dst`, which is [[ping-pong-buffering|ping-pong]] and is not optional. Reading and writing the same texture would mean a texel's result depends on whether its neighbour has been processed yet, which is exactly the undefined ordering that [[09_parallel-patterns|the parallel patterns note]] warns about. It is also why the passes are separate dispatches rather than a loop inside one shader, since there is no synchronisation between workgroups within a dispatch.

After nine passes the answer is in whichever texture the last pass wrote, which alternates with the pass count. Track it deliberately rather than assuming.

## Varying the step per pass

Each pass needs a different step value in its uniform block, and there are three ways to arrange it.

The clean production answer is one uniform buffer with a slot per pass and dynamic offsets on the bind group, which requires an explicit bind group layout with `hasDynamicOffset: true` rather than `layout: 'auto'`.

The simple answer, used in the checkpoint below, is a small uniform buffer per pass created once at initialisation, with the bind groups also created once. Nine tiny buffers cost nothing and the code stays readable.

The wrong answer is to write the same uniform buffer between passes within a frame, because all the passes are recorded before any of them run, so every pass would see the last value written.

## Checkpoint

A live Voronoi diagram. Seeds drift, jump flooding recomputes the labelling every frame, and each cell is coloured by a hash of its seed index.

```html
<!doctype html>
<meta charset="utf-8">
<title>Jump flooding</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
  canvas { display: block; width: 100vmin; height: 100vmin; margin: 0 auto; }
</style>
<canvas></canvas>
<script type="module">
const N = 512;            // grid size, a power of two
const SEEDS = 256;

const canvas = document.querySelector('canvas');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

// ---- Seeds ----
const seeds = new Float32Array(SEEDS * 4);   // x, y, vx, vy
for (let i = 0; i < SEEDS; i++) {
  seeds[i * 4 + 0] = Math.random() * N;
  seeds[i * 4 + 1] = Math.random() * N;
  seeds[i * 4 + 2] = (Math.random() - 0.5) * 30;
  seeds[i * 4 + 3] = (Math.random() - 0.5) * 30;
}

const seedBuffer = device.createBuffer({
  label: 'seeds',
  size: seeds.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(seedBuffer, 0, seeds);

// ---- Two ping-pong textures ----
const makeGrid = (label) => device.createTexture({
  label,
  size: [N, N],
  format: 'rgba32uint',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

const gridA = makeGrid('grid A');
const gridB = makeGrid('grid B');

// ---- Uniforms: one small buffer per JFA pass, written once ----
const steps = [];
for (let k = N >> 1; k >= 1; k >>= 1) steps.push(k);
steps.push(1);                        // the +1 pass

const stepBuffers = steps.map((k) => {
  const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, new Uint32Array([k, N, SEEDS, 0]));
  return b;
});

const seedParams = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(seedParams, 0, new Uint32Array([0, N, SEEDS, 0]));

const dtParams = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// ---- Shaders ----
const common = `
  struct Params {
    step: u32,
    size: u32,
    seedCount: u32,
    _pad: u32,
  }
`;

const clearModule = device.createShaderModule({
  label: 'clear',
  code: common + `
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var dst: texture_storage_2d<rgba32uint, write>;

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      if (gid.x >= params.size || gid.y >= params.size) { return; }
      textureStore(dst, vec2i(gid.xy), vec4u(0u, 0u, 0u, 0u));
    }
  `,
});

const seedModule = device.createShaderModule({
  label: 'seed',
  code: common + `
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var dst: texture_storage_2d<rgba32uint, write>;
    @group(0) @binding(2) var<storage, read> seeds: array<vec4f>;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let i = gid.x;
      if (i >= params.seedCount) { return; }

      let p = clamp(seeds[i].xy, vec2f(0.0), vec2f(f32(params.size) - 1.0));
      let c = vec2u(p);
      textureStore(dst, vec2i(c), vec4u(c.x, c.y, i, 1u));
    }
  `,
});

const jfaModule = device.createShaderModule({
  label: 'jfa',
  code: common + `
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var src: texture_2d<u32>;
    @group(0) @binding(2) var dst: texture_storage_2d<rgba32uint, write>;

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      if (gid.x >= params.size || gid.y >= params.size) { return; }

      let here = vec2f(gid.xy);
      let k = i32(params.step);
      let n = i32(params.size);

      var best = vec4u(0u, 0u, 0u, 0u);
      var bestDist = 1e30;

      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let c = vec2i(gid.xy) + vec2i(dx, dy) * k;
          if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) { continue; }

          let s = textureLoad(src, c, 0);
          if (s.w == 0u) { continue; }

          let d = distance(here, vec2f(f32(s.x), f32(s.y)));
          if (d < bestDist) { bestDist = d; best = s; }
        }
      }

      textureStore(dst, vec2i(gid.xy), best);
    }
  `,
});

const moveModule = device.createShaderModule({
  label: 'move',
  code: common + `
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read_write> seeds: array<vec4f>;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let i = gid.x;
      if (i >= params.seedCount) { return; }

      let dt = bitcast<f32>(params.step);
      var s = seeds[i];
      s = vec4f(s.xy + s.zw * dt, s.zw);

      let n = f32(params.size);
      if (s.x < 0.0 || s.x > n - 1.0) { s.z = -s.z; }
      if (s.y < 0.0 || s.y > n - 1.0) { s.w = -s.w; }
      s = vec4f(clamp(s.xy, vec2f(0.0), vec2f(n - 1.0)), s.zw);

      seeds[i] = s;
    }
  `,
});

const drawModule = device.createShaderModule({
  label: 'draw',
  code: common + `
    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var grid: texture_2d<u32>;

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) uv: vec2f,
    }

    @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
      let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
      var out: VSOut;
      out.pos = vec4f(p[i], 0.0, 1.0);
      out.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
      return out;
    }

    fn hashColour(x: u32) -> vec3f {
      var h = x * 2654435761u;
      h ^= h >> 15u;
      h *= 0x85ebca6bu;
      h ^= h >> 13u;
      let r = f32((h >>  0u) & 255u) / 255.0;
      let g = f32((h >>  8u) & 255u) / 255.0;
      let b = f32((h >> 16u) & 255u) / 255.0;
      return 0.25 + 0.7 * vec3f(r, g, b);
    }

    @fragment fn fs(in: VSOut) -> @location(0) vec4f {
      let c = vec2i(in.uv * f32(params.size));
      let s = textureLoad(grid, c, 0);
      if (s.w == 0u) { return vec4f(0.0, 0.0, 0.0, 1.0); }

      var colour = hashColour(s.z);

      // Darken near the seed itself so the sites are visible.
      let d = distance(vec2f(c), vec2f(f32(s.x), f32(s.y)));
      colour *= smoothstep(0.0, 3.0, d);

      return vec4f(colour, 1.0);
    }
  `,
});

for (const mod of [clearModule, seedModule, jfaModule, moveModule, drawModule]) {
  for (const m of (await mod.getCompilationInfo()).messages) {
    console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
  }
}

const clearPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: clearModule, entryPoint: 'main' } });
const seedPipeline  = device.createComputePipeline({ layout: 'auto', compute: { module: seedModule,  entryPoint: 'main' } });
const jfaPipeline   = device.createComputePipeline({ layout: 'auto', compute: { module: jfaModule,   entryPoint: 'main' } });
const movePipeline  = device.createComputePipeline({ layout: 'auto', compute: { module: moveModule,  entryPoint: 'main' } });

const drawPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module: drawModule, entryPoint: 'vs' },
  fragment: { module: drawModule, entryPoint: 'fs', targets: [{ format }] },
  primitive: { topology: 'triangle-list' },
});

const viewA = gridA.createView();
const viewB = gridB.createView();

const clearBind = device.createBindGroup({
  layout: clearPipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: seedParams } }, { binding: 1, resource: viewA }],
});

const seedBind = device.createBindGroup({
  layout: seedPipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: seedParams } },
    { binding: 1, resource: viewA },
    { binding: 2, resource: { buffer: seedBuffer } },
  ],
});

// One bind group per pass, alternating source and destination.
const jfaBinds = steps.map((_, i) => device.createBindGroup({
  layout: jfaPipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: stepBuffers[i] } },
    { binding: 1, resource: i % 2 === 0 ? viewA : viewB },
    { binding: 2, resource: i % 2 === 0 ? viewB : viewA },
  ],
}));

const finalView = steps.length % 2 === 0 ? viewA : viewB;

const moveBind = device.createBindGroup({
  layout: movePipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: dtParams } },
    { binding: 1, resource: { buffer: seedBuffer } },
  ],
});

const drawBind = device.createBindGroup({
  layout: drawPipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: seedParams } }, { binding: 1, resource: finalView }],
});

new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const s = Math.max(1, Math.min(entry.contentBoxSize[0].inlineSize,
                                 entry.contentBoxSize[0].blockSize) * dpr | 0);
  canvas.width = s;
  canvas.height = s;
}).observe(canvas);

const grids = Math.ceil(N / 8);
const seedGroups = Math.ceil(SEEDS / 64);
let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  // dt is smuggled through the step field as raw bits, purely to keep this demo short.
  device.queue.writeBuffer(dtParams, 0, new Uint32Array([
    new Uint32Array(new Float32Array([dt]).buffer)[0], N, SEEDS, 0,
  ]));

  const encoder = device.createCommandEncoder();

  const move = encoder.beginComputePass();
  move.setPipeline(movePipeline);
  move.setBindGroup(0, moveBind);
  move.dispatchWorkgroups(seedGroups);
  move.end();

  const init = encoder.beginComputePass();
  init.setPipeline(clearPipeline);
  init.setBindGroup(0, clearBind);
  init.dispatchWorkgroups(grids, grids);
  init.setPipeline(seedPipeline);
  init.setBindGroup(0, seedBind);
  init.dispatchWorkgroups(seedGroups);
  init.end();

  const jfa = encoder.beginComputePass();
  jfa.setPipeline(jfaPipeline);
  for (let i = 0; i < steps.length; i++) {
    jfa.setBindGroup(0, jfaBinds[i]);
    jfa.dispatchWorkgroups(grids, grids);
  }
  jfa.end();

  const render = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  render.setPipeline(drawPipeline);
  render.setBindGroup(0, drawBind);
  render.draw(3);
  render.end();

  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

You should see 256 coloured convex cells with straight edges, drifting and rearranging as the seeds move, with a dark dot marking each seed. The straightness of the edges is the visual proof that the labelling is right, since any error in the propagation shows up as ragged or blocky boundaries.

Note the two shortcuts taken to keep the example short, both flagged in the code. The dispatches for all nine passes share one compute pass, which is correct because each `dispatchWorkgroups` call is ordered against the previous one within a pass for resource hazards. And `dt` is passed as raw float bits through an integer field, which you would never do in real code, where you would simply declare a proper params struct.

Four experiments. Raise `SEEDS` to 20000 and observe that the frame time barely changes, which is the entire point of the algorithm. Remove the extra `steps.push(1)` and look for ragged boundaries, which may not be visible at all, and that is worth knowing too. Start the step sequence at `N` instead of `N >> 1` and watch the diagram break, because the first jump overshoots the grid. Finally, reverse the step order to go from 1 up to N/2 and watch it fail completely, which shows that decreasing order is essential rather than incidental.

## Failure modes

Blocky, square cell boundaries mean the step sequence is wrong, usually not reaching 1 or not starting at half the grid size.

Cells that flicker between frames mean the ping-pong is reading and writing the same texture, or the final view is the wrong one of the two.

Everything black means no seeds were written, so check the validity flag and the seed dispatch.

A single colour filling the screen means every texel found the same seed, which happens when the seed pass wrote all seeds to the same texel because of a coordinate scaling error.

Diagonal streaks generally mean the neighbourhood offsets are being applied without multiplying by the step size.

## Resources

Guodong Rong and Tiow-Seng Tan, [Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform](https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf), 2006, is the original paper, and it is short and readable. It also covers the error analysis and the JFA+1 variant.

[Red Blob Games](https://www.redblobgames.com/) is the best source for intuition about Voronoi diagrams and grid algorithms generally, with interactive diagrams throughout.

The same technique computes a distance transform for free, since `bestDist` is the distance to the nearest seed, which is useful for signed distance fields and outline effects.
