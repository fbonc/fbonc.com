# Instanced drawing and SDF circles

A particle renderer draws an enormous number of small, identical shapes. Doing that efficiently is a single technique, and once you have it, the rendering half of the project is essentially finished. Everything after this note is simulation.

## One draw call

The naive approach, a draw call per particle, fails for a reason that has nothing to do with the GPU. Each call has CPU overhead in validation and command recording, and a hundred thousand of them per frame will not fit in sixteen milliseconds no matter how fast the hardware is.

[[instancing|Instancing]] solves it. A single draw call runs the same small piece of geometry many times, and the shader distinguishes the copies by an index.

```js
pass.draw(4, particleCount);
```

That runs the vertex shader `4 * particleCount` times in one command. Each invocation receives `@builtin(vertex_index)` in the range 0 to 3, telling it which corner of the quad it is, and `@builtin(instance_index)`, telling it which particle. Everything else it looks up itself.

The geometry is four vertices as a `triangle-strip`, which makes a quad from four vertices rather than the six a `triangle-list` would need. In a strip, each vertex after the second forms a triangle with the previous two, so vertices 0, 1, 2 make one triangle and vertices 1, 2, 3 make the second. The corner order therefore has to zigzag rather than go round the perimeter.

```wgsl
let corner = array(
  vec2f(-1.0, -1.0),
  vec2f( 1.0, -1.0),
  vec2f(-1.0,  1.0),
  vec2f( 1.0,  1.0),
);
```

## Vertex pulling

There are no vertex buffers here. The shader reads particle data from a storage buffer using the instance index, which is [[vertex-pulling|vertex pulling]].

```wgsl
struct Particle {
  pos: vec2f,
  vel: vec2f,
  colour: u32,
  radius: f32,
  progress: f32,
  flags: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut { ... }
```

This is not merely a stylistic preference over the classic vertex buffer with attributes. It is the only arrangement that works here, because a compute shader writes into that same buffer as `read_write` and the renderer reads it as `read` on the next pass. The data never moves and the CPU never touches it. A vertex buffer with declared attributes would force a fixed interpretation on the same memory and buy nothing.

## Building the quad

The vertex shader turns a particle and a corner index into a clip space position. Working in pixels first and converting at the end is much easier to reason about, because radii are naturally expressed in pixels.

```wgsl
@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
  let corner = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1))[v];
  let p = particles[i];

  // Pad the quad slightly so the antialiased edge is not clipped.
  let r = p.radius + 1.0;
  let pixel = p.pos + corner * r;

  var out: VSOut;
  out.pos = vec4f(
     (pixel.x / params.resolution.x) * 2.0 - 1.0,
    -((pixel.y / params.resolution.y) * 2.0 - 1.0),
    0.0, 1.0);
  out.local = corner;
  out.colour = unpack4x8unorm(p.colour);
  out.radius = p.radius;
  return out;
}
```

Two details there matter more than they look.

The `y` is negated because [[clip-space|clip space]] has y increasing upward while pixel coordinates have it increasing downward. Get this wrong and everything renders mirrored vertically, which is easy to miss when your particle field is roughly symmetric.

The quad is one pixel larger than the radius. The fragment shader fades the circle's edge over about a pixel, and if the quad were exactly the radius, that fade would be cut off flat at the boundary. It is a one line fix for an artefact that is otherwise maddening to diagnose.

The `local` output is the interpolated corner value, running from -1 to 1 across the quad, which is what makes the fragment shader's job trivial.

## The SDF circle

A quad is a square. Making it a circle happens per pixel in the fragment shader, using a [[signed-distance-function|signed distance function]].

An SDF is a function returning the distance from a point to a shape's surface, negative inside and positive outside. For a circle centred at the origin it is as simple as a function gets.

```wgsl
fn sdCircle(p: vec2f, r: f32) -> f32 {
  return length(p) - r;
}
```

Because `local` runs from -1 to 1, the distance from the quad's centre is just `length(local)` and the edge is at 1. Converting that to a coverage value gives an antialiased circle.

```wgsl
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let d = length(in.local);

  // Width of one pixel in local units, so the fade is a constant screen size.
  let w = 1.0 / max(in.radius, 1.0);
  let alpha = 1.0 - smoothstep(1.0 - w, 1.0, d);

  if (alpha <= 0.0) { discard; }

  let a = in.colour.a * alpha;
  return vec4f(in.colour.rgb * a, a);   // premultiplied
}
```

The [[smoothstep|smoothstep]] call is what makes the edge smooth. A hard threshold would produce visibly jagged circles, and a fade of a fixed distance in local units would look correct on large particles and blurry on small ones, which is why the fade width is derived from the radius. This is a cheap, entirely per pixel form of antialiasing, and it is a large part of why SDF shapes are the standard way to draw particles.

Note the `discard` for fully transparent pixels, which is worth having because the corners of every quad are outside the circle and a blend that does nothing still costs bandwidth.

Inigo Quilez's [2D distance functions](https://iquilezles.org/articles/distfunctions2d/) catalogues dozens of these. You need one, but the article is worth skimming so that you know the technique generalises to rounded rectangles, stars, and anything else a scene might later want.

## Blending

Overlapping translucent particles need [[premultiplied-alpha|alpha blending]], configured on the pipeline rather than per draw.

```js
fragment: {
  module, entryPoint: 'fs',
  targets: [{
    format,
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    },
  }],
}
```

`srcFactor: 'one'` is what makes this premultiplied. The fragment shader has already multiplied the colour by alpha, so the blend equation does not need to do it again. The alternative, `src-alpha` with `one-minus-src-alpha`, expects unpremultiplied colour and is the more familiar formula, but premultiplied is better behaved. It composes correctly through intermediate render targets and it does not produce dark fringes around edges when textures are filtered.

For particles that should glow rather than occlude, additive blending with `srcFactor: 'one'` and `dstFactor: 'one'` is a one line change and looks completely different, so it is worth trying.

Note that with blending enabled, draw order matters. Blending is not commutative, so particles composite in the order the GPU rasterises them, which is instance order. For soft translucent dots this is unnoticeable. It is worth knowing before you wonder why a particular overlap looks wrong.

## Cost

At a hundred thousand particles, the vertex shader runs four hundred thousand times per frame, which is nothing. The fragment shader runs once per covered pixel, so cost scales with the total area covered rather than with the particle count. Doubling every radius quadruples the fragment work. If a dense particle field runs slowly, the radius is far more often the cause than the count, and that is worth checking before optimising anything clever.

## Checkpoint

Fifty thousand particles, one draw call, animated entirely in the vertex shader so that no simulation is needed yet.

```html
<!doctype html>
<meta charset="utf-8">
<title>Instanced SDF circles</title>
<style>
  html, body { margin: 0; height: 100%; background: #08080c; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
<canvas></canvas>
<script type="module">
const canvas = document.querySelector('canvas');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

const COUNT = 50000;
const STRIDE = 32;   // vec2f pos, vec2f vel, u32 colour, f32 radius, f32 seed, u32 flags

const bytes = new ArrayBuffer(COUNT * STRIDE);
const f32 = new Float32Array(bytes);
const u32 = new Uint32Array(bytes);

for (let i = 0; i < COUNT; i++) {
  const b = (i * STRIDE) / 4;
  f32[b + 0] = Math.random();          // pos, kept in 0..1 and scaled in the shader
  f32[b + 1] = Math.random();
  f32[b + 2] = 0;
  f32[b + 3] = 0;
  const hue = i / COUNT;
  const r = Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * hue)));
  const g = Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * hue + 2.09)));
  const bl = Math.round(255 * (0.5 + 0.5 * Math.cos(6.283 * hue + 4.19)));
  u32[b + 4] = r | (g << 8) | (bl << 16) | (200 << 24);
  f32[b + 5] = 1.0 + Math.random() * 2.5;   // radius in CSS pixels
  f32[b + 6] = Math.random() * 6.283;       // seed
  u32[b + 7] = 0;
}

const particles = device.createBuffer({
  label: 'particles',
  size: bytes.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(particles, 0, bytes);

const paramsBytes = new ArrayBuffer(16);
const paramsF32 = new Float32Array(paramsBytes);
const paramsBuffer = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const module = device.createShaderModule({
  label: 'particles',
  code: `
    struct Params {
      resolution: vec2f,
      time: f32,
      dpr: f32,
    }

    struct Particle {
      pos: vec2f,
      vel: vec2f,
      colour: u32,
      radius: f32,
      seed: f32,
      flags: u32,
    }

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) local: vec2f,
      @location(1) colour: vec4f,
      @location(2) radius: f32,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> particles: array<Particle>;

    @vertex
    fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
      let corner = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1))[v];
      let p = particles[i];

      // Animate here so no compute pass is needed yet.
      let wobble = vec2f(
        sin(params.time * 0.6 + p.seed),
        cos(params.time * 0.5 + p.seed * 1.7)
      ) * 40.0;

      let centre = p.pos * params.resolution + wobble;
      let r = (p.radius * params.dpr) + 1.0;
      let pixel = centre + corner * r;

      var out: VSOut;
      out.pos = vec4f(
         (pixel.x / params.resolution.x) * 2.0 - 1.0,
        -((pixel.y / params.resolution.y) * 2.0 - 1.0),
        0.0, 1.0);
      out.local = corner;
      out.colour = unpack4x8unorm(p.colour);
      out.radius = r;
      return out;
    }

    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      let d = length(in.local);
      let w = 1.0 / max(in.radius, 1.0);
      let alpha = 1.0 - smoothstep(1.0 - w, 1.0, d);
      if (alpha <= 0.0) { discard; }
      let a = in.colour.a * alpha;
      return vec4f(in.colour.rgb * a, a);
    }
  `,
});

for (const m of (await module.getCompilationInfo()).messages) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const pipeline = device.createRenderPipeline({
  label: 'particles',
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
    { binding: 1, resource: { buffer: particles } },
  ],
});

let dpr = 1;
new ResizeObserver(([entry]) => {
  dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
}).observe(canvas);

function frame(timeMs) {
  paramsF32[0] = canvas.width;
  paramsF32[1] = canvas.height;
  paramsF32[2] = timeMs / 1000;
  paramsF32[3] = dpr;
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.03, g: 0.03, b: 0.05, a: 1 },
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

Fifty thousand soft, coloured dots should drift smoothly at your display's refresh rate, from one draw call and one small uniform upload per frame.

Four experiments, each isolating one idea. Raise `COUNT` to 500000 and watch the frame time, which will probably still be fine, then instead multiply every radius by four and watch it collapse, which demonstrates that fragment area rather than particle count is the real cost. Remove the `+ 1.0` padding from the radius and look closely at an edge, where you will see it cut flat. Change the blend to `dstFactor: 'one'` for a glow. Finally delete the `-` before the y conversion and confirm the field flips, which is the fastest way to make clip space orientation stick.

## Failure modes

Square particles instead of circles mean the fragment shader is not using `local`, or the interpolated value is not reaching it because the `@location` numbers disagree.

Particles that are all in one corner or wildly spread usually mean pixel coordinates are being fed to clip space without the conversion, or the conversion is applied twice.

Hard, aliased edges mean `smoothstep` is being given a fade width of zero, which happens when the radius is in the wrong units.

Dark halos around particles mean unpremultiplied colour is being used with premultiplied blend factors, so either multiply the colour by alpha in the shader or change `srcFactor` to `src-alpha`.

Nothing visible at all, with no errors, is most often a particle buffer whose stride does not match the WGSL struct, which is [[06_memory-layout-and-alignment|the previous note]] taking its revenge.

## Resources

[Inigo Quilez, 2D distance functions](https://iquilezles.org/articles/distfunctions2d/) is the reference for SDF shapes, and the circle case is the first entry.

[webgpufundamentals.org, Transparency and blending](https://webgpufundamentals.org/webgpu/lessons/webgpu-transparency.html) explains the blend factors and the premultiplied versus unpremultiplied question in full.
