# Memory layout and alignment

This is the note that saves you a weekend. Every other mistake in WebGPU produces an error message. This one produces a picture that is subtly, inexplicably wrong, or particles that scramble the moment you add a field to a struct.

## The problem

A [[gpubuffer|GPUBuffer]] is bytes. WGSL imposes a struct on those bytes, and JavaScript writes those bytes with a typed array. Nothing checks that the two agree. If your shader thinks `radius` starts at byte 20 and your JavaScript wrote it at byte 16, the shader reads whatever is at byte 20 and carries on without complaint.

The reason the two can disagree is that WGSL does not pack struct fields tightly. It inserts padding so that every field begins at an address that is a multiple of that field's alignment, because GPU memory hardware fetches in aligned blocks and a value straddling a block boundary would cost an extra fetch. So the layout is not simply the sum of the field sizes, and you have to compute it the way the specification does.

## The rules

Every type has two numbers, an alignment and a size, and they are not always equal.

| Type | Align | Size |
| --- | --- | --- |
| `f32`, `i32`, `u32` | 4 | 4 |
| `vec2f`, `vec2u`, `vec2i` | 8 | 8 |
| `vec3f`, `vec3u`, `vec3i` | 16 | 12 |
| `vec4f`, `vec4u`, `vec4i` | 16 | 16 |
| `mat2x2f` | 8 | 16 |
| `mat3x3f` | 16 | 48 |
| `mat4x4f` | 16 | 64 |

Look at `vec3f`, which has size 12 and alignment 16. That mismatch is the source of most alignment bugs in every shading language ever designed, and the practical advice is old and reliable, which is to avoid `vec3` in anything that crosses the CPU boundary. Use `vec4f`, or use `vec2f` plus scalars.

From those two numbers, three composition rules follow.

A struct field is placed at the next offset that is a multiple of its own alignment, with padding inserted before it if necessary. A struct's alignment is the largest alignment among its fields. A struct's size is the offset of its last field plus that field's size, rounded up to a multiple of the struct's own alignment, so trailing padding is real and matters.

An array's element stride is the element's size rounded up to the element's alignment, and the array's size is the count times that stride. So `array<vec3f, 4>` occupies 64 bytes, not 48, because each element is padded from 12 to 16.

## Working an example by hand

```wgsl
struct Particle {
  pos: vec2f,       // align 8
  vel: vec2f,       // align 8
  colour: u32,      // align 4
  radius: f32,      // align 4
  progress: f32,    // align 4
  flags: u32,       // align 4
}
```

Walking it through, `pos` needs a multiple of 8 and 0 qualifies, so it sits at 0 and occupies bytes 0 to 7. `vel` needs a multiple of 8 and 8 qualifies, so bytes 8 to 15. `colour` needs a multiple of 4, so byte 16. Then `radius` at 20, `progress` at 24, `flags` at 28.

The struct's alignment is 8, the largest among its fields. The last field ends at byte 32, and 32 is already a multiple of 8, so the size is 32 with no trailing padding.

That is a well designed struct. It is exactly 32 bytes, every field is where you would naively guess, and a `Float32Array` view of 8 elements per particle maps to it directly. Layouts like this do not happen by accident, they happen because someone ordered the fields deliberately.

Now the same fields in a careless order.

```wgsl
struct Careless {
  radius: f32,      // offset 0
  pos: vec3f,       // align 16, so offset 16, with 12 bytes of padding at 4
  flags: u32,       // offset 28
  vel: vec2f,       // align 8, so offset 32
}                   // align 16, size 48
```

Same information, 48 bytes instead of 32, and two invisible gaps. Across a hundred thousand particles that is 1.6 MB of padding and a proportional loss of memory bandwidth, which on a GPU is usually the thing that limits you.

The design rules that fall out of this are short. Order fields from the largest alignment down to the smallest. Prefer `vec2f` and `vec4f` over `vec3f`. Aim for a total size that is a multiple of 16. Pack colours into a single `u32` with `pack4x8unorm` rather than spending a `vec4f`.

## Explicit control

WGSL lets you override placement with attributes, which is occasionally the clearest way to state your intent.

```wgsl
struct Params {
  @align(16) resolution: vec2f,
  @size(16) time: f32,
  count: u32,
}
```

`@align(n)` forces a field to start at a multiple of n, and `@size(n)` forces a field to occupy at least n bytes. Use them sparingly, as documentation of a constraint you actually have, rather than as a way to avoid understanding the default rules.

## The uniform address space is stricter

Uniform buffers carry additional constraints that storage buffers do not, and they exist because uniform data flows through different hardware paths.

Array element stride in the uniform address space must be a multiple of 16. This means `array<vec2f, 8>` is legal as a storage buffer and illegal as a uniform, because its natural stride is 8. A struct used as a uniform array element is likewise padded up to a multiple of 16.

The practical consequence is to keep uniforms as a single flat struct of scalars and vectors, and put anything array shaped in a storage buffer. That is what an engine does anyway.

## Making the CPU side agree

There are three approaches, in ascending order of reliability.

The first is to write the offsets by hand in a comment and be careful. This works until someone adds a field.

The second is to compute the layout in JavaScript from a declaration, so the two sides derive from a single description rather than being maintained in parallel. This is what the checkpoint below does.

The third is to use a library that parses your actual WGSL source and generates the layout from it, which removes the possibility of drift entirely. [webgpu-utils](https://github.com/greggman/webgpu-utils) by Gregg Tavares does exactly this, and for a real project it is the sensible answer.

Whichever you choose, do the same structural thing. Define the layout in exactly one file, expose named setters or offsets, and never let a byte offset appear as a literal anywhere else. A layout constant that exists in two places will eventually exist in two different states.

It is also worth adding a startup assertion that checks the computed size against the size the shader expects, so that a mismatch fails loudly at boot instead of quietly at frame one.

## Checkpoint

Two parts. First a layout calculator that implements the rules above, then a visual test that proves the shader and JavaScript agree, because a calculator that is wrong in the same way as your assumptions proves nothing.

The test draws eight horizontal bands. Each band reads one element of a storage array of structs and takes its colour from a packed `u32` field and its brightness from an `f32` field. If the layout is right you get eight specific, recognisable colours. If it is wrong you get noise, and the failure is immediate and obvious rather than subtle.

```html
<!doctype html>
<meta charset="utf-8">
<title>Layout</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; font: 13px/1.5 ui-monospace, monospace; color: #ddd; }
  canvas { display: block; width: 100%; height: 60vh; }
  pre { margin: 0; padding: 12px; }
</style>
<canvas></canvas>
<pre id="out"></pre>
<script type="module">
// ---- A minimal implementation of the WGSL layout rules ----

const SCALARS = {
  f32: [4, 4], u32: [4, 4], i32: [4, 4],
  vec2f: [8, 8], vec2u: [8, 8], vec2i: [8, 8],
  vec3f: [16, 12], vec3u: [16, 12], vec3i: [16, 12],
  vec4f: [16, 16], vec4u: [16, 16], vec4i: [16, 16],
};

const roundUp = (k, n) => Math.ceil(n / k) * k;

function layout(fields) {
  let offset = 0;
  let structAlign = 1;
  const out = [];

  for (const [name, type] of fields) {
    const [align, size] = SCALARS[type];
    offset = roundUp(align, offset);
    out.push({ name, type, offset, size, align });
    structAlign = Math.max(structAlign, align);
    offset += size;
  }

  return { fields: out, align: structAlign, size: roundUp(structAlign, offset) };
}

// This declaration must match the WGSL struct below, field for field.
const ITEM = layout([
  ['colour', 'u32'],
  ['brightness', 'f32'],
  ['pos', 'vec2f'],
]);

const out = document.getElementById('out');
out.textContent =
  `struct Item  align=${ITEM.align}  size=${ITEM.size}\n` +
  ITEM.fields.map(f => `  +${String(f.offset).padStart(3)}  ${f.name.padEnd(11)} ${f.type}`).join('\n') +
  `\n\nCompare with the careless ordering:\n` +
  (() => {
    const bad = layout([['radius','f32'], ['pos','vec3f'], ['flags','u32'], ['vel','vec2f']]);
    return `struct Careless  align=${bad.align}  size=${bad.size}\n` +
      bad.fields.map(f => `  +${String(f.offset).padStart(3)}  ${f.name.padEnd(11)} ${f.type}`).join('\n');
  })();

// ---- Fill the buffer using the computed offsets, never literals ----

const COUNT = 8;
const bytes = new ArrayBuffer(ITEM.size * COUNT);
const u32 = new Uint32Array(bytes);
const f32 = new Float32Array(bytes);

const palette = [
  [244,  67,  54], [255, 152,   0], [255, 235,  59], [ 76, 175,  80],
  [  0, 188, 212], [ 63,  81, 181], [156,  39, 176], [255, 255, 255],
];

const off = Object.fromEntries(ITEM.fields.map(f => [f.name, f.offset]));

for (let i = 0; i < COUNT; i++) {
  const base = i * ITEM.size;
  const [r, g, b] = palette[i];
  // pack4x8unorm reads the low byte as .x, so red goes in the low byte.
  u32[(base + off.colour) / 4] = r | (g << 8) | (b << 16) | (255 << 24);
  f32[(base + off.brightness) / 4] = 0.25 + 0.75 * (i / (COUNT - 1));
  f32[(base + off.pos) / 4 + 0] = 0;
  f32[(base + off.pos) / 4 + 1] = 0;
}

// ---- Render ----

const canvas = document.querySelector('canvas');
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error('WebGPU not available');

const context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

const itemBuffer = device.createBuffer({
  label: 'items',
  size: bytes.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(itemBuffer, 0, bytes);

const module = device.createShaderModule({
  label: 'bands',
  code: `
    struct Item {
      colour: u32,
      brightness: f32,
      pos: vec2f,
    }

    @group(0) @binding(0) var<storage, read> items: array<Item>;

    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      return vec4f(p[i], 0.0, 1.0);
    }

    @fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
      let n = arrayLength(&items);
      let band = min(u32(frag.y / 64.0), n - 1u);
      let item = items[band];
      let rgba = unpack4x8unorm(item.colour);
      return vec4f(rgba.rgb * item.brightness, 1.0);
    }
  `,
});

for (const m of (await module.getCompilationInfo()).messages) {
  console[m.type === 'error' ? 'error' : 'warn'](`${m.lineNum}:${m.linePos} ${m.message}`);
}

const pipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:   { module, entryPoint: 'vs' },
  fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  primitive: { topology: 'triangle-list' },
});

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: itemBuffer } }],
});

canvas.width = 512;
canvas.height = 512;

const encoder = device.createCommandEncoder();
const pass = encoder.beginRenderPass({
  colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    clearValue: { r: 0, g: 0, b: 0, a: 1 },
    loadOp: 'clear',
    storeOp: 'store',
  }],
});
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindGroup);
pass.draw(3);
pass.end();
device.queue.submit([encoder.finish()]);
</script>
```

You should see eight bands running red, orange, yellow, green, cyan, indigo, purple, white, each brighter than the one above it. The printed table should report `Item` with alignment 8 and size 16, and `Careless` with alignment 16 and size 48.

Now break it in the way that actually happens in practice. Insert a `flags: u32` field into the WGSL struct after `colour`, but not into the JavaScript declaration. There will be no error of any kind. The bands will simply turn into the wrong colours, because every element after the first is now read from a different stride than the one it was written at. This is precisely the bug that eats a weekend, and having produced it deliberately once, you will recognise its signature immediately, which is data that starts correct and degrades progressively as the index rises.

Then fix it by adding the field to the JavaScript declaration too, and notice that nothing else in the program had to change, because no byte offset was ever written as a literal.

## Failure modes

Data correct for element zero and increasingly wrong afterwards means the stride disagrees, so the struct size is wrong on one side.

All elements wrong in the same way means a field offset disagrees, usually because a field was added or reordered in one place only.

An error about a uniform buffer's binding size or stride means you put an array in a uniform buffer with a stride that is not a multiple of 16.

Values that are enormous or tiny by a factor of a few billion usually mean a `u32` is being read as an `f32` or the reverse, which is an offset error rather than a type error.

## Resources

[webgpufundamentals.org, Memory layout](https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html) covers the same rules and includes an interactive layout visualiser that is genuinely useful for checking your working.

The [WGSL specification's alignment and size section](https://www.w3.org/TR/WGSL/#alignment-and-size) is the authoritative table, including the uniform address space constraints, and is worth bookmarking rather than reading.

[webgpu-utils](https://github.com/greggman/webgpu-utils) derives layouts directly from WGSL source and removes this class of bug at the cost of a dependency.
