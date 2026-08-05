# Shaders and the render pipeline

Clearing a canvas needs no shaders. Drawing anything needs two, and it needs a pipeline object to hold them.

## What the render pipeline does

The render pipeline is a fixed sequence, part programmable and part hardware, and it always runs in the same order.

Your vertex shader runs once per vertex and returns a clip space position. The rasteriser, which is fixed function hardware you configure but do not program, groups those vertices into primitives, works out which pixels each primitive covers, and interpolates any extra values you attached to the vertices across that area. Your fragment shader then runs once per covered pixel and returns a colour. Finally the blending and write stage combines that colour with whatever is already in the target texture.

Two of those five stages are yours to write. The rest are configured through the pipeline descriptor.

## Clip space

A vertex shader's required output is a position in [[clip-space|clip space]], not in pixels. Clip space runs from -1 to +1 horizontally with +1 at the right, and from -1 to +1 vertically with +1 at the top. The centre of the screen is the origin.

Note that the vertical direction is the opposite of the DOM convention, where y grows downward. Getting this backwards renders a perfectly correct image upside down, which is a mistake you will make once.

The output is a `vec4f` rather than a `vec2f` because the fourth component supports perspective division, which a 2D project never uses. Write `vec4f(x, y, 0.0, 1.0)` and the value passes through unchanged.

Converting pixels to clip space is arithmetic you will write many times.

```wgsl
let clip = vec2f(
   (px.x / resolution.x) * 2.0 - 1.0,
  -((px.y / resolution.y) * 2.0 - 1.0),
);
```

Texture coordinates are a separate convention again, with the origin at the top left and the range running from 0 to 1. Three coordinate systems, one project, and most confusing bugs in early graphics work are a mix-up between them.

## The shader module

Both shaders are written in [[05_wgsl-language-tour|WGSL]] and compiled into a shader module. One module can hold many entry points, and it is normal to keep a vertex and fragment pair in the same module since they share the struct that passes data between them.

```js
const module = device.createShaderModule({
  label: 'triangle',
  code: `
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let pos = array(
        vec2f( 0.0,  0.5),
        vec2f(-0.5, -0.5),
        vec2f( 0.5, -0.5),
      );
      return vec4f(pos[i], 0.0, 1.0);
    }

    @fragment fn fs() -> @location(0) vec4f {
      return vec4f(1.0, 0.4, 0.1, 1.0);
    }
  `,
});
```

Set `label` on everything you create. Labels are free and they appear in validation messages, which turns an unreadable complaint about an anonymous object into one that names the thing you got wrong.

Note what this shader does not have. There is no vertex buffer and no geometry uploaded from JavaScript. The shader is told which vertex it is through `@builtin(vertex_index)` and looks the position up itself. That technique is called [[vertex-pulling|vertex pulling]], and it is not a toy shortcut. It is precisely how the particle renderer works, except that it reads from a storage buffer of a hundred thousand particles instead of a hardcoded array of three positions.

Shader compilation errors are reported asynchronously and do not throw from `createShaderModule()`. Wire up the reporting immediately.

```js
const info = await module.getCompilationInfo();
for (const m of info.messages) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}
```

## The pipeline

A render pipeline binds a vertex entry point, a fragment entry point, the output formats, and the fixed function state into one immutable object.

```js
const pipeline = device.createRenderPipeline({
  label: 'triangle',
  layout: 'auto',
  vertex:   { module, entryPoint: 'vs' },
  fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  primitive: { topology: 'triangle-list' },
});
```

`layout: 'auto'` asks WebGPU to infer the [[bind-group-layout|bind group layout]] from the shader source, which is convenient and correct for a single pipeline. It has a real limitation, since layouts generated automatically are unique to their pipeline and a bind group made for one cannot be used with another. An engine that shares a set of bindings across several compute passes will eventually declare layouts explicitly for that reason, but not yet.

`targets` must match the attachments of the render pass that will use this pipeline, which is why the canvas format from the previous note reappears here. A mismatch is a validation error rather than a wrong colour.

`topology` describes how vertices become primitives, and `triangle-list` treats every three vertices as an independent triangle. The particle renderer uses `triangle-strip`, in which each new vertex forms a triangle with the previous two, so that a four vertex quad costs four vertices rather than six.

Pipeline creation is expensive because it compiles shaders down to native code. Create pipelines during initialisation, never inside the frame loop. There is also `createRenderPipelineAsync()`, which does the same work without blocking, and is what you would use in production to avoid a hitch on first draw.

## Passing data between the stages

Anything the fragment shader needs beyond the position has to be produced per vertex and interpolated. These are inter-stage variables, matched by `@location(n)`.

```wgsl
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) colour: vec3f,
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  let pos = array(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
  let cols = array(vec3f(1, 0, 0), vec3f(0, 1, 0), vec3f(0, 0, 1));

  var out: VSOut;
  out.pos = vec4f(pos[i], 0.0, 1.0);
  out.colour = cols[i];
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.colour, 1.0);
}
```

The locations connect the stages, not the field names, and the types at each location must agree. What arrives in the fragment shader is a weighted blend of the three vertex values according to where inside the triangle the pixel lies. Only `@builtin(position)` is special, since in the fragment shader it holds the pixel's coordinates in the target texture rather than the clip space value the vertex shader returned.

This mechanism is what draws a circle in the next part. The vertex shader emits a local offset per corner of a quad, the rasteriser interpolates it, and the fragment shader uses the interpolated value to decide how far from the centre it is.

## Issuing the draw

Inside the render pass, set the pipeline and call `draw`.

```js
pass.setPipeline(pipeline);
pass.draw(3);
```

`draw(vertexCount, instanceCount, firstVertex, firstInstance)` takes up to four arguments, and the second one is the whole basis of the particle renderer. Calling `draw(4, 100000)` runs the vertex shader four times for each of a hundred thousand instances, in a single command. That is covered in [[07_instanced-drawing-and-sdf-circles|instanced drawing]].

## Checkpoint

An interpolated triangle. Reuse the setup from the previous note and change the frame body.

```html
<!doctype html>
<meta charset="utf-8">
<title>Triangle</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; }
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

const module = device.createShaderModule({
  label: 'triangle',
  code: `
    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) colour: vec3f,
    }

    @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
      let pos  = array(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
      let cols = array(vec3f(1, 0, 0), vec3f(0, 1, 0), vec3f(0, 0, 1));
      var out: VSOut;
      out.pos = vec4f(pos[i], 0.0, 1.0);
      out.colour = cols[i];
      return out;
    }

    @fragment fn fs(in: VSOut) -> @location(0) vec4f {
      return vec4f(in.colour, 1.0);
    }
  `,
});

for (const m of (await module.getCompilationInfo()).messages) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const pipeline = device.createRenderPipeline({
  label: 'triangle',
  layout: 'auto',
  vertex:   { module, entryPoint: 'vs' },
  fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  primitive: { topology: 'triangle-list' },
});

const observer = new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
});
observer.observe(canvas);

function frame() {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(pipeline);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

A smoothly shaded triangle, red at the top, should appear.

Two experiments earn their time. Negate the `y` values in `pos` and watch it flip, which fixes clip space orientation in your memory permanently. Then introduce a deliberate typo in the WGSL, such as `vec2f(0.0)` given three arguments, and confirm your compilation info handler prints a line number, because that handler is the difference between a five second fix and a blank screen.

## Failure modes

Nothing renders and there are no errors. Check that the shader compiled, since a module with errors produces a pipeline that draws nothing, and check that the triangle is not off screen or wound outside the -1 to 1 range.

A validation error about attachment format means the pipeline's `targets[0].format` and the canvas format disagree.

A location mismatch error means a `@location` exists on one side of the stage boundary and not the other, or the types differ.

## Resources

[webgpufundamentals.org, Inter-stage variables](https://webgpufundamentals.org/webgpu/lessons/webgpu-inter-stage-variables.html) is the direct companion to this note.

[MDN, GPURenderPipeline](https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPipeline) documents every field of the descriptor, most of which this project leaves at its default.
