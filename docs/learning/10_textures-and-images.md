# Textures and images

Buffers are one dimensional arrays. Textures are the other kind of GPU memory, laid out for two dimensional access, and they are how images get in and how grid shaped intermediate results get stored.

The project needs three things from textures. It needs to load an image and read its pixels, it needs to write computed results into a grid from a compute shader, and it needs to feed one pass's output into the next pass's input. That is the whole scope, and it excludes most of what a texture chapter in a graphics book would cover.

## Why textures and not buffers

You could store a grid in a buffer and index it with `y * width + x`, and sometimes that is the right choice. Textures earn their place for three reasons.

Their memory is arranged so that pixels near each other in two dimensions are near each other in memory, which is called swizzled or tiled layout. A compute shader reading a neighbourhood of pixels gets far better cache behaviour than the equivalent buffer indexing would.

They have dedicated hardware for filtering, so reading at a fractional coordinate and getting a smooth interpolation between neighbouring pixels costs nothing extra.

And they handle edges for you, clamping or wrapping out of range coordinates according to the sampler, rather than requiring a bounds check in the shader.

## Creating a texture

```js
const texture = device.createTexture({
  label: 'source image',
  size: [width, height],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING
       | GPUTextureUsage.COPY_DST
       | GPUTextureUsage.RENDER_ATTACHMENT,
});
```

[[texture-formats|Formats]] name the components, their bit depth, and how they are interpreted. In `rgba8unorm`, each of four channels is 8 bits, and `unorm` means the stored 0 to 255 is presented to the shader as a float from 0.0 to 1.0. The variants you might need are `r32float` for a single high precision channel, and `rg32uint` for a pair of integers, which is the natural format for storing coordinates in a [[14_voronoi-and-jump-flooding|jump flooding]] pass.

There is also `rgba8unorm-srgb`, which applies gamma conversion on read and write. It matters for colour correctness in a full renderer. It is a distraction here, and mixing it up with the plain variant produces images that look slightly washed out or slightly too contrasty, so pick one and be consistent.

Usage flags work as they do for buffers. `TEXTURE_BINDING` allows a shader to sample it, `STORAGE_BINDING` allows a compute shader to write it, `RENDER_ATTACHMENT` allows a render pass to draw into it, and `COPY_DST` allows data to be copied in. Uploading an image needs `COPY_DST` and `RENDER_ATTACHMENT` together, which is surprising until you know that the browser implements the upload as a draw.

You bind a view rather than the texture itself, via `texture.createView()`, which is what lets a single texture expose one mip level or one array layer.

## Getting an image in

The browser decodes images, not WebGPU. The path is an `ImageBitmap` and a single copy call.

```js
const response = await fetch(url);
const blob = await response.blob();
const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

device.queue.copyExternalImageToTexture(
  { source: bitmap, flipY: false },
  { texture },
  [bitmap.width, bitmap.height],
);
```

Pass `colorSpaceConversion: 'none'` when you intend to treat the pixels as data rather than as colour, which is exactly the case when computing a density map, because otherwise the browser may apply a colour profile conversion and change your numbers.

The same call accepts an `HTMLCanvasElement` or an `OffscreenCanvas` directly, which is the route for anything you render yourself with Canvas2D before handing it to the GPU. That is worth knowing because it means text, shapes, and anything the DOM can produce can become a texture without a file ever existing.

Remember that images load asynchronously and the GPU does not wait. A frame that renders before the copy has been submitted samples an empty texture, which appears as black. Sequence the load explicitly rather than hoping.

## Reading a texture in a shader

There are two ways, and choosing correctly matters.

`textureSample` takes normalised coordinates from 0 to 1, applies the [[sampler|sampler's]] filtering and addressing rules, and returns an interpolated value. It is available only in fragment shaders, because filtering needs the derivative information that the rasteriser provides.

```wgsl
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
```

`textureLoad` takes integer pixel coordinates and a mip level, does no filtering, needs no sampler, and works everywhere including compute shaders.

```wgsl
@group(0) @binding(0) var tex: texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(tex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let texel = textureLoad(tex, vec2i(gid.xy), 0);
}
```

Compute passes use `textureLoad`. That is not a stylistic preference, it is the rule, and it is why sampling an image to build a density map is done with integer coordinates.

Note the two dimensional workgroup size and the two dimensional bounds check. Grid shaped work gets a grid shaped dispatch, and the guard has to cover both axes.

A sampler is created separately and describes filtering and edge behaviour.

```js
const sampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
});
```

## Writing from a compute shader

A [[storage-texture|storage texture]] is a texture a compute shader can write into directly.

```wgsl
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

textureStore(dst, vec2i(gid.xy), vec4f(value, value, value, 1.0));
```

Two constraints shape how you use them. The format is part of the type in the shader and must match the texture exactly, and in core WebGPU the access mode is write only, so a shader cannot read the storage texture it is writing. Reading and writing the same grid therefore means two textures and [[ping-pong-buffering|ping-pong]], which is the same conclusion the parallel patterns note reached from the other direction.

The alternative to a storage texture is rendering into a texture, by using it as a render pass attachment instead of the canvas. That path gets you blending and the rasteriser, which storage textures do not have. Use a render target when you want to draw shapes into a grid, and a storage texture when you want to compute a value per cell.

## Textures between passes

Chaining passes is the normal case. One pass writes a texture, the next binds it as a sampled texture and reads it. As with buffers, WebGPU inserts the synchronisation, so recording the passes in order is sufficient.

The one rule that catches people is that a texture cannot be bound as a storage texture for writing and as a sampled texture for reading in the same pass. If a pass needs both, it needs two textures.

## Checkpoint

The full image to density path, which is directly the input to [[13_density-and-rejection-sampling|rejection sampling]]. A source image is generated with Canvas2D so the example needs no files and no CORS handling, uploaded to a texture, converted to a luminance based density map by a compute pass writing a storage texture, and both are displayed side by side.

```html
<!doctype html>
<meta charset="utf-8">
<title>Textures</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
  canvas#gpu { display: block; width: 100%; height: 100%; }
</style>
<canvas id="gpu"></canvas>
<script type="module">
const W = 512, H = 512;

// ---- Make a source image with Canvas2D, so there is nothing to fetch ----
const src = document.createElement('canvas');
src.width = W; src.height = H;
const ctx = src.getContext('2d');
ctx.fillStyle = '#fff';
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#000';
ctx.font = 'bold 150px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('GPU', W / 2, H / 2 - 60);
ctx.beginPath();
ctx.arc(W / 2, H / 2 + 110, 90, 0, Math.PI * 2);
ctx.fillStyle = '#888';
ctx.fill();

const bitmap = await createImageBitmap(src, { colorSpaceConversion: 'none' });

// ---- Device ----
const canvas = document.getElementById('gpu');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

// ---- Source texture ----
const source = device.createTexture({
  label: 'source',
  size: [W, H],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING
       | GPUTextureUsage.COPY_DST
       | GPUTextureUsage.RENDER_ATTACHMENT,
});

device.queue.copyExternalImageToTexture(
  { source: bitmap, flipY: false },
  { texture: source },
  [W, H],
);

// ---- Density target, written by compute ----
const density = device.createTexture({
  label: 'density',
  size: [W, H],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

const computeModule = device.createShaderModule({
  label: 'density',
  code: `
    @group(0) @binding(0) var src: texture_2d<f32>;
    @group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) gid: vec3u) {
      let dims = textureDimensions(src);
      if (gid.x >= dims.x || gid.y >= dims.y) { return; }

      let texel = textureLoad(src, vec2i(gid.xy), 0);

      // Perceptual luminance, then invert so that dark ink means high density.
      let lum = dot(texel.rgb, vec3f(0.2126, 0.7152, 0.0722));
      let d = 1.0 - lum;

      textureStore(dst, vec2i(gid.xy), vec4f(d, d, d, 1.0));
    }
  `,
});

const blitModule = device.createShaderModule({
  label: 'blit',
  code: `
    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) uv: vec2f,
    }

    @group(0) @binding(0) var texA: texture_2d<f32>;
    @group(0) @binding(1) var texB: texture_2d<f32>;
    @group(0) @binding(2) var samp: sampler;

    @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
      let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
      var out: VSOut;
      out.pos = vec4f(p[i], 0.0, 1.0);
      // Map clip space to 0..1 with y flipped, since textures start at the top.
      out.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
      return out;
    }

    @fragment fn fs(in: VSOut) -> @location(0) vec4f {
      // Left half shows the source, right half the computed density.
      if (in.uv.x < 0.5) {
        return textureSample(texA, samp, vec2f(in.uv.x * 2.0, in.uv.y));
      }
      let d = textureSample(texB, samp, vec2f((in.uv.x - 0.5) * 2.0, in.uv.y)).r;
      return vec4f(d * 0.2, d * 0.9, d, 1.0);
    }
  `,
});

for (const m of [...(await computeModule.getCompilationInfo()).messages,
                 ...(await blitModule.getCompilationInfo()).messages]) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const computePipeline = device.createComputePipeline({
  layout: 'auto',
  compute: { module: computeModule, entryPoint: 'main' },
});

const blitPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module: blitModule, entryPoint: 'vs' },
  fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format }] },
  primitive: { topology: 'triangle-list' },
});

const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

const computeBind = device.createBindGroup({
  layout: computePipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: source.createView() },
    { binding: 1, resource: density.createView() },
  ],
});

const blitBind = device.createBindGroup({
  layout: blitPipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: source.createView() },
    { binding: 1, resource: density.createView() },
    { binding: 2, resource: sampler },
  ],
});

new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
  draw();
}).observe(canvas);

function draw() {
  const encoder = device.createCommandEncoder();

  const compute = encoder.beginComputePass();
  compute.setPipeline(computePipeline);
  compute.setBindGroup(0, computeBind);
  compute.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
  compute.end();

  const render = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  render.setPipeline(blitPipeline);
  render.setBindGroup(0, blitBind);
  render.draw(3);
  render.end();

  device.queue.submit([encoder.finish()]);
}

draw();
</script>
```

The left half shows white text and a grey circle on white, and the right half shows the inverted density in blue, bright where the source is dark. The grey circle appears at mid brightness on the right, which is the point, because density is continuous rather than a binary mask.

Three experiments. Change the storage texture's format in the WGSL to `rgba16float` without changing the JavaScript and read the validation error, which is how you learn that the format really is part of the type. Change the compute dispatch to `dispatchWorkgroups(W, H)` and note it still works but runs 64 times more workgroups than needed, each with 63 idle invocations. Remove the y flip in the vertex shader's `uv` calculation and watch the image turn upside down, which is the third coordinate convention from [[03_shaders-and-render-pipeline|the pipeline note]] catching you in practice.

## Failure modes

A black texture usually means the image had not finished loading and copying before the first draw, or that `copyExternalImageToTexture` was called on a texture lacking `RENDER_ATTACHMENT` usage.

An upside down image is the texture coordinate convention, fixable either with `flipY: true` in the copy or by flipping in the shader, but pick one place and stay there.

A validation error about storage texture access means the format in the WGSL type does not match the texture, or the texture lacks `STORAGE_BINDING`.

An error saying a texture is used as both writable and readable in the same pass means one texture is doing two jobs and you need two.

Colours that are subtly off across the whole image are usually an `srgb` format mismatch, or a colour space conversion applied during `createImageBitmap`.

## Resources

[webgpufundamentals.org, Textures](https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html) and [Importing textures](https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html) cover creation, sampling, and the image upload path in detail.

[webgpufundamentals.org, Storage textures](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-textures.html) is short and covers the compute writing case exactly.
