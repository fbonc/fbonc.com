# Density and rejection sampling

The remaining notes are algorithms rather than API. They are here because the project needs them, and they are presented in their general form, since none of them is specific to particles.

This one answers a single question. Given an image, how do you place N points so that their density follows the image, with more points where the image is dark and fewer where it is light. That is stippling, the technique behind engraved illustrations and dot based printing, and it starts with turning an image into a probability distribution.

## From image to density

A density function assigns a non negative weight to every point in the domain, and the weight need not be normalised as long as you know its maximum.

Building one from an image is two steps. Convert colour to a single number, then decide which direction means more.

```wgsl
let lum = dot(texel.rgb, vec3f(0.2126, 0.7152, 0.0722));
let density = 1.0 - lum;
```

Those coefficients are the Rec. 709 luminance weights, and they are not arbitrary. Human vision is far more sensitive to green than to blue, so a plain average of the channels makes blues look darker than they appear and yellows look lighter. Using perceptual weights makes the resulting stipple pattern match how the image actually looks.

The inversion is because ink is dark. A white page has no dots, and a black region should be dense with them.

Two refinements matter in practice. Applying a gamma, so `density = pow(1.0 - lum, gamma)`, controls contrast in the stipple pattern, with values above 1 pushing midtones lighter and thinning out the dots there. And clamping the minimum to a small positive value prevents entire regions from being unreachable, which matters for the [[15_lloyd-relaxation|relaxation]] step later, since a cell with zero total density has an undefined centroid.

## Sampling from a distribution

You now have a function `ρ(x, y)` and you want N points distributed according to it. The general problem is sampling from an arbitrary distribution, and there are several standard approaches.

Inverse transform sampling builds a cumulative distribution and inverts it. It is exact and efficient, and in two dimensions it requires building a cumulative table over rows and then within each row, which is entirely doable but fiddly and awkward to parallelise.

Rejection sampling is the alternative, and it trades some efficiency for near total simplicity.

## Rejection sampling

The algorithm is three lines.

Pick a candidate point uniformly at random over the domain. Pick a uniform random number `u` between 0 and 1. Accept the point if `u < ρ(x, y) / ρ_max`, and otherwise discard it and try again.

```js
function sample(density, w, h, max) {
  for (;;) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const u = Math.random();
    if (u < density[(y | 0) * w + (x | 0)] / max) return [x, y];
  }
}
```

Why it works is worth seeing rather than taking on faith. A candidate at a given location is proposed with uniform probability, and accepted with probability proportional to `ρ` at that location. The probability that a returned point lands somewhere is therefore the product of the two, which is proportional to `ρ`. The uniform proposal cancels out, and what remains is exactly the distribution you wanted.

The geometric reading is that you are throwing darts uniformly at the volume under the surface `ρ`, and keeping the x and y of the ones that land below it.

## The cost

The acceptance rate is the mean of `ρ` divided by its maximum, so an image that is mostly white rejects most candidates. A drawing with five percent ink coverage accepts roughly one candidate in twenty, so placing 20000 points costs about 400000 attempts.

That is fine, because those attempts are trivial and this runs once per image rather than per frame. It is worth knowing the failure case though, which is that a distribution with a single very high peak and a low mean can reject almost everything, and if you ever hit that, inverse transform sampling is the answer.

Dividing by the true maximum rather than by 1.0 matters here. It costs one pass over the image and can improve the acceptance rate by an order of magnitude on a low contrast source.

## Why the result is not good enough

Sample a portrait this way and you get something recognisable and slightly wrong. The dots clump. There are visible clusters and visible gaps, and the texture looks noisy rather than even.

The reason is that independent random samples are white noise, and white noise clumps by construction. Each sample knows nothing about the others, so nothing prevents two from landing almost on top of each other. In any random uniform scatter, roughly a third of the points have a neighbour much closer than the average spacing.

What stippling wants is blue noise, a distribution that is random in the sense of having no visible pattern, but where points repel each other so the spacing is locally even. Blue noise looks organic. White noise looks like a mistake.

There are direct ways to generate blue noise, notably Poisson disc sampling with Bridson's algorithm, which rejects any candidate falling within a minimum radius of an existing point. It works well and is a reasonable choice when the desired spacing is uniform.

The approach this project takes instead is to start from rejection sampling and then relax the points, which is [[15_lloyd-relaxation|Lloyd relaxation]]. Relaxation handles varying density naturally, converges to an even spacing that respects the density function, and animates beautifully, which the direct methods do not.

So the honest summary is that rejection sampling gives you a correct but ugly starting point, and it is the right starting point precisely because the next step is going to move everything anyway.

## Where to run it

On the CPU, once per image. It is inherently sequential in the sense that each sample loops until it succeeds, and the total work is small and done at a scene change rather than per frame.

A GPU version is possible, giving each invocation a fixed number of attempts and compacting the successes, but it is more complex and solves a problem you do not have. The relaxation that follows is the part that needs the GPU, because it runs every frame.

## Checkpoint

An image becomes a stipple. The density map is built on the CPU from the same generated source as [[10_textures-and-images|the textures note]], points are rejection sampled from it, and they are drawn as particles.

```html
<!doctype html>
<meta charset="utf-8">
<title>Rejection sampling</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; }
  canvas { display: block; width: 100vmin; height: 100vmin; margin: 0 auto; }
  #hud { position: fixed; top: 8px; left: 8px; font: 13px ui-monospace, monospace; color: #333; }
</style>
<canvas></canvas>
<div id="hud"></div>
<script type="module">
const W = 512, H = 512;
const COUNT = 20000;
const GAMMA = 1.0;

// ---- Source image ----
const src = document.createElement('canvas');
src.width = W; src.height = H;
const ctx = src.getContext('2d', { willReadFrequently: true });
const grad = ctx.createLinearGradient(0, 0, W, H);
grad.addColorStop(0, '#fff');
grad.addColorStop(1, '#bbb');
ctx.fillStyle = grad;
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#000';
ctx.font = 'bold 160px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('dots', W / 2, H / 2 - 70);
ctx.fillStyle = '#555';
ctx.beginPath();
ctx.arc(W / 2, H / 2 + 110, 95, 0, Math.PI * 2);
ctx.fill();

// ---- Density map ----
const pixels = ctx.getImageData(0, 0, W, H).data;
const density = new Float32Array(W * H);
let maxDensity = 0;

for (let i = 0; i < W * H; i++) {
  const r = pixels[i * 4] / 255;
  const g = pixels[i * 4 + 1] / 255;
  const b = pixels[i * 4 + 2] / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const d = Math.pow(Math.max(0, 1 - lum), GAMMA);
  density[i] = d;
  if (d > maxDensity) maxDensity = d;
}

// ---- Rejection sampling ----
const points = new Float32Array(COUNT * 2);
let attempts = 0;

for (let n = 0; n < COUNT; n++) {
  for (;;) {
    attempts++;
    const x = Math.random() * W;
    const y = Math.random() * H;
    const u = Math.random();
    if (u * maxDensity < density[(y | 0) * W + (x | 0)]) {
      points[n * 2] = x;
      points[n * 2 + 1] = y;
      break;
    }
  }
}

document.getElementById('hud').textContent =
  `${COUNT} points from ${attempts} attempts\n` +
  `acceptance ${(100 * COUNT / attempts).toFixed(1)}%  max density ${maxDensity.toFixed(3)}`;

// ---- Render ----
const canvas = document.querySelector('canvas');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

const pointBuffer = device.createBuffer({
  label: 'points',
  size: points.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(pointBuffer, 0, points);

const paramsBytes = new ArrayBuffer(16);
const pF32 = new Float32Array(paramsBytes);
const paramsBuffer = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const module = device.createShaderModule({
  label: 'stipple',
  code: `
    struct Params {
      resolution: vec2f,
      source: f32,     // size of the source image in pixels
      radius: f32,
    }

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) local: vec2f,
    }

    @group(0) @binding(0) var<uniform> params: Params;
    @group(0) @binding(1) var<storage, read> points: array<vec2f>;

    @vertex
    fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VSOut {
      let corner = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1))[v];

      // Source image space to canvas pixels.
      let scale = params.resolution.x / params.source;
      let centre = points[i] * scale;
      let r = params.radius + 1.0;
      let pixel = centre + corner * r;

      var out: VSOut;
      out.pos = vec4f(
         (pixel.x / params.resolution.x) * 2.0 - 1.0,
        -((pixel.y / params.resolution.y) * 2.0 - 1.0),
        0.0, 1.0);
      out.local = corner;
      return out;
    }

    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      let d = length(in.local);
      let w = 1.0 / max(params.radius + 1.0, 1.0);
      let alpha = 1.0 - smoothstep(1.0 - w, 1.0, d);
      if (alpha <= 0.0) { discard; }
      return vec4f(vec3f(0.0) * alpha, alpha);
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
    { binding: 1, resource: { buffer: pointBuffer } },
  ],
});

new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const s = Math.max(1, Math.min(entry.contentBoxSize[0].inlineSize,
                                 entry.contentBoxSize[0].blockSize) * dpr | 0);
  canvas.width = s;
  canvas.height = s;
  draw();
}).observe(canvas);

function draw() {
  pF32[0] = canvas.width;
  pF32[1] = canvas.height;
  pF32[2] = W;
  pF32[3] = 1.1;
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 1, g: 1, b: 1, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(4, COUNT);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

draw();
</script>
```

The word and the circle should appear as clouds of black dots, dense in the black text, sparser in the grey circle, sparser still in the light gradient, and absent in the white. The HUD reports the acceptance rate, which for this image will be somewhere around ten to fifteen percent.

Now look closely at an even grey region, which is the point of the exercise. The dots clump. There are clusters and holes that have nothing to do with the image, and they are the white noise problem made visible. Keep this image in mind, because [[15_lloyd-relaxation|Lloyd relaxation]] is what fixes it and the difference is dramatic.

Three experiments. Set `GAMMA` to 2.0 and watch the midtones thin out while the blacks stay dense. Remove the division by `maxDensity`, by comparing `u < density[...]` directly, and watch the acceptance rate change. Raise `COUNT` to 200000 and reduce the radius, which starts to look like a real engraving and also shows that the clumping never goes away with more samples, since it is a property of the process rather than of the sample size.

## Failure modes

Points concentrated in one corner usually mean the density index is computed with width and height transposed.

No points at all, or a loop that never terminates, means the density is zero everywhere, which happens if the inversion is missing and the image is mostly white.

An acceptance rate near zero means the density has a sharp peak, or the maximum is being taken as 1.0 when the true maximum is far lower.

Points that do not line up with the image mean the source image space to canvas space scaling is wrong, which is easy when the two are different sizes.

## Resources

Adrian Secord, [Weighted Voronoi Stippling](https://www.cs.ubc.ca/labs/imager/tr/2002/secord2002b/secord.2002b.pdf), 2002, is short, readable, and describes exactly this pipeline of density map, initial sampling, and relaxation.

Robert Bridson, [Fast Poisson Disk Sampling in Arbitrary Dimensions](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf), 2007, is two pages and is the standard direct approach to blue noise, worth knowing as the alternative.
