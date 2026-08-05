# Spatial ordering and matching

The last algorithm. You have a set of particles at their current positions and a set of target positions, and you need to decide which particle goes to which target. That decision has no effect on the final image and an enormous effect on how the transition between images looks.

## The assignment problem

Formally this is the linear assignment problem. Given N particles, N targets, and a cost for each possible pairing, find the one to one assignment that minimises the total cost. With squared distance as the cost, the optimal assignment is the one where particles travel the least total distance.

The Hungarian algorithm solves it exactly in `O(n³)`. At a hundred thousand particles that is 10¹⁵ operations, which is not a large number in the sense of being close to feasible, it is a number that will never finish. Even the better approximations are far out of reach at this scale.

So the exact answer is unavailable, which is fine, because you do not want the optimal assignment. You want one that looks good, and those are not the same thing.

## Why the assignment is visible

Consider what random assignment produces. Every particle travels to an unrelated target, so paths cross constantly, the motion has no discernible structure, and the transition reads as a burst of noise that happens to resolve into a shape. It looks like static.

Now consider a spatially coherent assignment, where particles near each other are sent to targets near each other. Paths run roughly parallel, neighbourhoods move together, and the whole field appears to flow from one shape into the other. It reads as one thing transforming rather than many things scattering.

The perceptual mechanism is common fate, the grouping principle that says elements moving together are perceived as a single object. Coherent assignment satisfies it and random assignment defeats it.

Both are worth having, since the noisy version is a legitimate effect when you want one. It should be a choice rather than an accident.

## Sorting instead of matching

The trick that makes this tractable is to stop treating it as a matching problem at all.

If you can order each set of points along a path that visits nearby points consecutively, then sorting both sets by that order and pairing them by rank gives a spatially coherent assignment. Particle at rank 7 goes to target at rank 7, and because rank correlates with position in both sets, nearby particles get nearby targets.

The cost is two sorts, so `O(n log n)`, which at a hundred thousand points is a few milliseconds on the CPU. It runs once per transition rather than per frame, so it is entirely affordable.

What you need is a way to reduce a two dimensional position to a one dimensional key that preserves locality, which is a space filling curve.

## Morton codes

A [[morton-code|Morton code]], also called a Z-order curve, is the simplest useful space filling curve. You take the binary representations of the x and y coordinates and interleave their bits.

```
x = 0b1011
y = 0b0110
morton = 0b01101101      (y3 x3 y2 x2 y1 x1 y0 x0)
```

Sorting by that interleaved value visits the plane in a recursive Z shaped pattern, covering one quadrant entirely before moving to the next, and recursing within each. Points close together in space almost always have close Morton codes, because they share high order bits.

The interleaving is done with a standard bit twiddling sequence that spreads each bit out to every other position.

```js
function part1by1(n) {
  n &= 0x0000ffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  n = (n | (n << 1)) & 0x55555555;
  return n;
}

const morton = (x, y) => ((part1by1(y) << 1) | part1by1(x)) >>> 0;
```

Each step doubles the spacing between bits, and the masks clear the space being moved into. It is worth tracing one value through by hand once, because it is otherwise entirely opaque, and it is the same trick used to build octree keys and spatial hashes throughout graphics.

Two practical points. The inputs must be non negative integers, so positions are quantised first, typically by mapping the bounding box of the point set onto a 16 bit range. And the result of a 16 bit interleave occupies 32 bits, where JavaScript's bitwise operators produce a signed value, so the `>>> 0` is required or half your codes sort as negative numbers.

## The limitation, and the alternative

Morton codes have a known weakness. At quadrant boundaries the curve makes a long jump, so two points that are physically adjacent but on opposite sides of a major boundary can have very distant codes. Visually this shows up as occasional seams in the transition where a band of particles travels much further than its neighbours.

The Hilbert curve fixes this, since it is continuous and never makes long jumps, giving measurably better locality. It costs more to compute, requiring a rotation step per level rather than a fixed bit shuffle, but it is still cheap in absolute terms.

The pragmatic order is to implement Morton first because it is fifteen lines, look at the result, and move to Hilbert only if the seams actually bother you. For a dense field of small particles in motion they usually do not.

Simpler orderings are sometimes better still. Sorting by angle around a centre produces a rotational sweep. Sorting by x produces a wipe. Sorting by distance from a point produces a radial bloom. These are worse at minimising distance and better as deliberate effects, which is a reminder that coherence is an aesthetic target rather than an optimisation one.

## Where it runs

On the CPU, once per transition. It is a sort, sorts are sequential, and the work happens at a scene change rather than every frame.

GPU sorting is a real technique, with bitonic sort being the standard parallel approach, and it is worth knowing it exists. It is not worth implementing here, because the CPU version takes a few milliseconds at a moment when nothing else is happening, and the result is a single buffer upload.

That upload is the output of the whole process. The matcher produces one integer per particle saying which target it owns, uploaded once, and the per frame shader simply reads its own target index.

## A second benefit

Spatial ordering has a use beyond aesthetics. If the particle buffer itself is kept in Morton order, then particles that are near each other in space are near each other in memory, so a shader whose invocations read neighbouring particles gets far better cache behaviour. This is the memory coherence point from [[12_debugging-and-performance|the performance note]], and it is why spatial sorting appears in physics engines and neighbour searches where no one cares how the transition looks.

## Checkpoint

Two point sets and a morphing transition, with the assignment strategy switchable at runtime so the difference is directly visible.

```html
<!doctype html>
<meta charset="utf-8">
<title>Matching</title>
<style>
  html, body { margin: 0; height: 100%; background: #0a0a0f; }
  canvas { display: block; width: 100vmin; height: 100vmin; margin: 0 auto; }
  #hud { position: fixed; top: 8px; left: 8px; font: 13px ui-monospace, monospace; color: #8cf; }
</style>
<canvas></canvas>
<div id="hud"></div>
<script type="module">
const COUNT = 60000;
const SIZE = 1000;

// ---- Two shapes, generated analytically ----
const A = new Float32Array(COUNT * 2);
const B = new Float32Array(COUNT * 2);

for (let i = 0; i < COUNT; i++) {
  // A: a filled disc
  const r = Math.sqrt(Math.random()) * 380;
  const t = Math.random() * Math.PI * 2;
  A[i * 2]     = SIZE / 2 + Math.cos(t) * r;
  A[i * 2 + 1] = SIZE / 2 + Math.sin(t) * r;

  // B: a five pointed star outline, thickened
  const u = Math.random() * Math.PI * 2;
  const spikes = 5;
  const k = 0.5 + 0.5 * Math.cos(spikes * u);
  const rad = (150 + 230 * k) + (Math.random() - 0.5) * 26;
  B[i * 2]     = SIZE / 2 + Math.cos(u) * rad;
  B[i * 2 + 1] = SIZE / 2 + Math.sin(u) * rad;
}

// ---- Morton ordering ----
function part1by1(n) {
  n &= 0x0000ffff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  n = (n | (n << 1)) & 0x55555555;
  return n;
}

const morton = (x, y) => ((part1by1(y) << 1) | part1by1(x)) >>> 0;

function mortonOrder(points) {
  const codes = new Uint32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    // Quantise into 16 bits over the known domain.
    const qx = Math.min(65535, Math.max(0, (points[i * 2]     / SIZE * 65535) | 0));
    const qy = Math.min(65535, Math.max(0, (points[i * 2 + 1] / SIZE * 65535) | 0));
    codes[i] = morton(qx, qy);
  }
  const order = new Uint32Array(COUNT);
  for (let i = 0; i < COUNT; i++) order[i] = i;
  return order.sort((p, q) => codes[p] - codes[q]);
}

// assignment[i] is the index into B that particle i travels to.
function buildAssignment(mode) {
  const assignment = new Uint32Array(COUNT);

  if (mode === 'random') {
    const shuffled = Uint32Array.from({ length: COUNT }, (_, i) => i);
    for (let i = COUNT - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < COUNT; i++) assignment[i] = shuffled[i];
    return assignment;
  }

  const orderA = mortonOrder(A);
  const orderB = mortonOrder(B);
  for (let rank = 0; rank < COUNT; rank++) {
    assignment[orderA[rank]] = orderB[rank];
  }
  return assignment;
}

// ---- Device ----
const canvas = document.querySelector('canvas');
const hud = document.getElementById('hud');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

const bufA = device.createBuffer({ size: A.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const bufB = device.createBuffer({ size: B.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(bufA, 0, A);
device.queue.writeBuffer(bufB, 0, B);

const bufAssign = device.createBuffer({
  size: COUNT * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

let mode = 'morton';
function applyMode() {
  const t0 = performance.now();
  const assignment = buildAssignment(mode);
  device.queue.writeBuffer(bufAssign, 0, assignment);
  hud.textContent = `${mode}  (${(performance.now() - t0).toFixed(1)} ms for ${COUNT} points)\npress 1 for random, 2 for morton`;
}
applyMode();

addEventListener('keydown', (e) => {
  if (e.key === '1') { mode = 'random'; applyMode(); }
  if (e.key === '2') { mode = 'morton'; applyMode(); }
});

const paramsBytes = new ArrayBuffer(16);
const pF32 = new Float32Array(paramsBytes);
const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

const module = device.createShaderModule({
  label: 'morph',
  code: `
    struct Params {
      resolution: vec2f,
      t: f32,
      domain: f32,
    }

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) local: vec2f,
      @location(1) tint: vec3f,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> a: array<vec2f>;
    @group(0) @binding(2) var<storage, read> b: array<vec2f>;
    @group(0) @binding(3) var<storage, read> assignment: array<u32>;

    @vertex
    fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
      let corner = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1))[v];

      let from = a[i];
      let to = b[assignment[i]];

      // Ease so the motion accelerates and settles rather than moving linearly.
      let e = smoothstep(0.0, 1.0, params.t);
      let p = mix(from, to, e);

      let scale = params.resolution.x / params.domain;
      let r = 1.6;
      let pixel = p * scale + corner * r;

      var out: VSOut;
      out.pos = vec4f(
         (pixel.x / params.resolution.x) * 2.0 - 1.0,
        -((pixel.y / params.resolution.y) * 2.0 - 1.0),
        0.0, 1.0);
      out.local = corner;

      // Colour by how far this particle has to travel, which makes the
      // difference between the two matching strategies obvious.
      let dist = length(to - from) / params.domain;
      out.tint = mix(vec3f(0.25, 0.65, 1.0), vec3f(1.0, 0.35, 0.25), clamp(dist * 2.0, 0.0, 1.0));
      return out;
    }

    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      let d = length(in.local);
      let alpha = (1.0 - smoothstep(0.4, 1.0, d)) * 0.85;
      if (alpha <= 0.0) { discard; }
      return vec4f(in.tint * alpha, alpha);
    }
  `,
});

for (const m of (await module.getCompilationInfo()).messages) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const pipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module, entryPoint: 'vs' },
  fragment: {
    module, entryPoint: 'fs',
    targets: [{
      format,
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
    }],
  },
  primitive: { topology: 'triangle-strip' },
});

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: bufA } },
    { binding: 2, resource: { buffer: bufB } },
    { binding: 3, resource: { buffer: bufAssign } },
  ],
});

new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const s = Math.max(1, Math.min(entry.contentBoxSize[0].inlineSize,
                                 entry.contentBoxSize[0].blockSize) * dpr | 0);
  canvas.width = s;
  canvas.height = s;
}).observe(canvas);

function frame(now) {
  // Ping-pong between the two shapes with a pause at each end.
  const cycle = (now / 1000) % 6;
  const t = cycle < 3
    ? Math.min(1, Math.max(0, (cycle - 0.5) / 2))
    : 1 - Math.min(1, Math.max(0, (cycle - 3.5) / 2));

  pF32[0] = canvas.width;
  pF32[1] = canvas.height;
  pF32[2] = t;
  pF32[3] = SIZE;
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(4, COUNT);
  pass.end();
  device.queue.submit([encoder.finish()]);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

A disc should morph into a five pointed star and back. Press 1 and 2 to switch strategies while it runs, which is the point of the exercise.

With Morton matching the field flows, neighbourhoods stay together, and most particles are blue because they travel short distances. With random matching the same two shapes are connected by a chaotic swarm, nearly every particle is red, and the intermediate frames are structureless. The shapes at either end are pixel for pixel identical in both cases, which is what makes the comparison honest, since the only thing that changed is the assignment.

Three further experiments. Watch the timing in the HUD, which shows that matching sixty thousand points costs single digit milliseconds and confirms that this belongs on the CPU at transition time. Replace the Morton key with plain `y * SIZE + x` and observe that row major order gives coherence in one axis only, producing a horizontal shearing motion. Then sort by `Math.atan2(y - centre, x - centre)` instead and watch the transition become a rotational sweep, which is not better or worse but is a completely different effect obtained by changing one line.

## Failure modes

Particles that pile onto a handful of targets mean the assignment is not a permutation, so some targets are used many times and others not at all. Both orderings must be sorts of the same index set.

A transition that is coherent in one region and chaotic in another is usually the sign bug, so check the `>>> 0` on the Morton code.

Coherence that works in one axis only means the interleave is broken and the key is effectively one dimensional.

A visible seam where a band of particles travels much further than its neighbours is the Morton quadrant jump, which is expected behaviour rather than a bug, and the Hilbert curve is the fix if it matters.

## Resources

[Red Blob Games](https://www.redblobgames.com/) covers space filling curves with interactive diagrams and is the clearest available intuition for why Morton and Hilbert differ.

[Bit Twiddling Hacks, interleaving bits](https://graphics.stanford.edu/~seander/bithacks.html#InterleaveBMN) is the source for the magic number sequence, along with several alternatives.

The [Wikipedia article on the Hungarian algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm) is worth a skim purely to see what the exact solution requires, which makes the case for the sorting approach better than any argument.
