# WGSL language tour

WGSL is the only language WebGPU accepts. It is small, statically typed, and deliberately boring, and you can hold the whole of it in your head. This note is the language itself, treated as a language, so that later notes can discuss algorithms without stopping to explain syntax.

If you know C, Rust, or TypeScript, most of this will land immediately. The parts that surprise people are the strictness about types, the absence of pointers in the places you expect them, and [[address-spaces|address spaces]].

## Scalars and vectors

The scalar types are `f32`, `i32`, `u32` and `bool`. There is an optional `f16` behind a feature flag, which this project does not need.

Vectors are `vec2<T>`, `vec3<T>` and `vec4<T>`, and the shorthand aliases `vec2f`, `vec3f`, `vec4f` for floats, with `vec2u`, `vec2i` and so on for the integer variants. The aliases are ordinary WGSL, not a convention, and they are what you will see in modern code.

```wgsl
let a = vec2f(1.0, 2.0);
let b = vec3f(0.0);          // all three components zero
let c = vec4f(a, 3.0, 4.0);  // vectors concatenate into larger ones
```

Swizzling works as it does in every shading language, and it works on both sides of an assignment.

```wgsl
let p = vec4f(1.0, 2.0, 3.0, 4.0);
let q = p.xy;      // vec2f(1, 2)
let r = p.wzyx;    // reversed
let s = p.xxy;     // repetition is fine

var v = vec2f(0.0);
v.y = 5.0;
```

Arithmetic on vectors is component wise, including multiplication, so `vec2f(2,3) * vec2f(4,5)` is `vec2f(8,15)` and not a dot product. Mixing a vector and a scalar broadcasts the scalar.

## Types are strict

This is the rule that catches newcomers, and it catches them repeatedly. There are no implicit conversions between `f32`, `i32` and `u32`. Every conversion is written out.

```wgsl
let n: u32 = 10u;
let x = f32(n) * 0.5;      // required
// let y = n * 0.5;        // error: no operator between u32 and f32
```

Literals have their own rules. A bare `1` is an abstract integer that will settle into `i32` or `u32` as context demands, `1u` is explicitly `u32`, and `1.0` is `f32`. Writing `1` where a float is wanted usually works because the abstract literal converts, but writing an `i32` variable there does not. When in doubt, be explicit, since the error messages name the exact types involved and are easy to act on.

Loop counters over array indices should be `u32`, because that is what `arrayLength` and the invocation builtins give you.

## Values and variables

`let` declares an immutable binding, `var` declares a mutable one, and `const` declares a compile time constant usable where a constant is required, such as an array size.

```wgsl
const MAX_STEPS = 64;

fn f(t: f32) -> f32 {
  let k = 2.0;         // immutable
  var acc = 0.0;       // mutable
  acc = acc + k * t;
  return acc;
}
```

Prefer `let`. A `var` at function scope lives in the private address space and may cost a register or worse, and more importantly immutability makes shader code much easier to reason about when several things are being updated in the same pass.

There is also `override`, a pipeline overridable constant whose value can be supplied at pipeline creation time rather than baked into the source.

```wgsl
override WORKGROUP_SIZE: u32 = 64u;
```

This is genuinely useful for tuning a [[workgroup|workgroup size]] per device without recompiling the shader source by hand.

## Control flow

Conditionals, loops and switches are conventional.

```wgsl
if (x > 0.0) { ... } else if (x < 0.0) { ... } else { ... }

for (var i = 0u; i < n; i++) { ... }

while (d > eps) { ... }

loop {
  ...
  continuing { i++; }   // runs before the next iteration, including after `continue`
}

switch (mode) {
  case 0u: { ... }
  case 1u, 2u: { ... }
  default: { ... }
}
```

A `switch` must have a `default`, and cases do not fall through. The bare `loop` with a `continuing` block is WGSL's primitive form and you rarely write it directly.

Remember the cost model from [[01_gpu-mental-model|the mental model]]. Branches are not free when neighbouring invocations disagree, and a loop whose trip count varies per invocation costs everyone the longest path. Shader code therefore leans on branchless helpers.

```wgsl
let y = select(a, b, cond);        // note the order: false value first
let z = clamp(x, 0.0, 1.0);
let w = mix(a, b, t);              // linear interpolation
let s = smoothstep(0.0, 1.0, t);   // eased 0 to 1 with zero slope at both ends
let f = step(edge, x);             // 0.0 below the edge, 1.0 at or above
```

The argument order of `select` is a common bug, since it is the false value, then the true value, then the condition. It is the reverse of a ternary.

## Functions

```wgsl
fn sdCircle(p: vec2f, r: f32) -> f32 {
  return length(p) - r;
}
```

Parameters are passed by value and are immutable inside the function. There is no recursion at all, since a shader's call graph must be statically finite, and there are no function pointers, no closures, and no overloading of your own functions. Built in functions are overloaded, but yours are not.

To modify a caller's variable you pass a pointer explicitly.

```wgsl
fn addTo(acc: ptr<function, vec2f>, v: vec2f) {
  *acc = *acc + v;
}

var total = vec2f(0.0);
addTo(&total, vec2f(1.0, 2.0));
```

Pointers exist but are heavily restricted. They cannot be stored in structs, returned from functions, or placed in arrays. In practice you use them for exactly two things, which are out parameters like the above, and passing atomics to helper functions.

## Structs and arrays

```wgsl
struct Particle {
  pos: vec2f,
  vel: vec2f,
  colour: u32,
  radius: f32,
}

var<private> scratch: array<f32, 16>;
```

Fixed size arrays need a constant length. Runtime sized arrays, written `array<T>` with no length, are allowed only as the store type of a storage buffer or as the last member of a struct in one, and `arrayLength(&items)` gives the count derived from the bound buffer size.

The way struct fields are actually placed in memory is the subject of [[06_memory-layout-and-alignment|the next note]], and it is the one part of WGSL that will silently corrupt your data rather than refusing to compile.

## Address spaces

Every variable in module scope lives in a named [[address-spaces|address space]], and the space determines where the memory is, who can see it, and whether it can be written.

```wgsl
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> targets: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;

var<workgroup> tile: array<f32, 64>;
var<private> seed: u32;
```

The `uniform` space is small and read only. The `storage` space is large and is the only one a shader can write into for output, requiring the explicit `read_write` access mode to do so. The `workgroup` space is memory shared by the invocations of a single [[workgroup|workgroup]] and vanishes when they finish. The `private` space is per invocation, and `function` is the implicit space of ordinary local variables.

A fragment shader may not write to a storage buffer in the core specification, so all read and write bulk work belongs in compute.

## Entry points and builtins

Entry points are marked with a stage attribute, and their inputs and outputs are annotated.

```wgsl
@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> @builtin(position) vec4f { ... }

@fragment
fn fs(@builtin(position) frag: vec4f, @location(0) uv: vec2f) -> @location(0) vec4f { ... }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) { ... }
```

The builtins that matter for this project are `vertex_index` and `instance_index` in the vertex stage, `position` in both the vertex output and the fragment input where its meaning changes from clip space to pixel coordinates, and `global_invocation_id` in compute, which answers the question of which item this invocation is responsible for.

A fragment shader may also call `discard` to throw away the pixel entirely, which is different from returning a transparent colour and interacts with depth and blending.

## The built in function library

You will reach for a small subset constantly.

Geometry and vectors give you `length`, `distance`, `normalize`, `dot`, `cross`, and `reflect`. Maths gives `abs`, `sign`, `floor`, `ceil`, `round`, `fract`, `min`, `max`, `pow`, `exp`, `log`, `sqrt`, `inverseSqrt`, and the trigonometric functions including `atan2`. Interpolation gives `mix`, `clamp`, `saturate`, `step`, `smoothstep` and `select`.

Two bit manipulation helpers matter later. `pack4x8unorm` takes a `vec4f` of values in the zero to one range and packs it into a single `u32` of four bytes, and `unpack4x8unorm` reverses it. That pair is how a colour is stored in four bytes rather than sixteen, which is a meaningful saving across a hundred thousand particles.

There is no random number generator. Shaders that need randomness hash their invocation index, and a standard cheap hash is enough.

```wgsl
fn hash(x: u32) -> u32 {
  var h = x;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

fn rand01(x: u32) -> f32 {
  return f32(hash(x)) * 2.3283064e-10;   // divide by 2^32
}
```

## Checkpoint

A shader that exercises structs, functions, loops, swizzles, `select` and `mix` in one place. It draws a field of animated blobs whose colours come from a struct array, using no new API concepts beyond the previous note.

```html
<!doctype html>
<meta charset="utf-8">
<title>WGSL tour</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; }
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

const paramsBytes = new ArrayBuffer(16);
const paramsF32 = new Float32Array(paramsBytes);
const paramsBuffer = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const module = device.createShaderModule({
  label: 'tour',
  code: `
    struct Params {
      resolution: vec2f,
      time: f32,
      _pad: f32,
    }

    @group(0) @binding(0) var<uniform> params: Params;

    const COUNT = 12u;
    const TAU = 6.2831853;

    fn hash(x: u32) -> u32 {
      var h = x;
      h ^= h >> 16u;
      h *= 0x7feb352du;
      h ^= h >> 15u;
      h *= 0x846ca68bu;
      h ^= h >> 16u;
      return h;
    }

    fn rand01(x: u32) -> f32 {
      return f32(hash(x)) * 2.3283064e-10;
    }

    // Signed distance to a circle: negative inside, zero on the edge.
    fn sdCircle(p: vec2f, r: f32) -> f32 {
      return length(p) - r;
    }

    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      return vec4f(p[i], 0.0, 1.0);
    }

    @fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
      let uv = (frag.xy / params.resolution) * 2.0 - 1.0;
      let aspect = params.resolution.x / params.resolution.y;
      let p = vec2f(uv.x * aspect, -uv.y);

      var colour = vec3f(0.02, 0.02, 0.04);

      for (var i = 0u; i < COUNT; i++) {
        let phase = rand01(i * 7u + 1u) * TAU;
        let speed = 0.3 + rand01(i * 13u + 5u) * 0.7;
        let orbit = 0.25 + rand01(i * 29u + 3u) * 0.7;
        let radius = 0.04 + rand01(i * 31u + 9u) * 0.07;

        let centre = vec2f(cos(params.time * speed + phase),
                           sin(params.time * speed * 0.7 + phase)) * orbit;

        let d = sdCircle(p - centre, radius);

        // Antialiased fill: 1 inside, 0 outside, soft over a few pixels.
        let edge = 2.0 / params.resolution.y;
        let fill = 1.0 - smoothstep(-edge, edge, d);

        let warm = vec3f(1.0, 0.55, 0.2);
        let cool = vec3f(0.2, 0.6, 1.0);
        let tint = select(cool, warm, (i % 2u) == 0u);

        colour = mix(colour, tint, fill);
      }

      return vec4f(colour, 1.0);
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
  entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
});

new ResizeObserver(([entry]) => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width  = Math.max(1, entry.contentBoxSize[0].inlineSize * dpr | 0);
  canvas.height = Math.max(1, entry.contentBoxSize[0].blockSize  * dpr | 0);
}).observe(canvas);

function frame(timeMs) {
  paramsF32[0] = canvas.width;
  paramsF32[1] = canvas.height;
  paramsF32[2] = timeMs / 1000;
  device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```

Twelve crisp circles in two colours should drift on their own orbits. They stay circular at any window shape and their edges stay smooth, because `smoothstep` is fading over a fixed number of pixels rather than a fixed distance in the shader's coordinate space.

Three deliberate errors are worth causing, because each teaches a specific compiler message. Swap the arguments of `select` and watch the colours invert. Write `i * 0.5` without the `f32()` conversion and read the type error. Change `let` to `var` on `phase` and note that nothing complains, which is exactly why the discipline has to come from you.

## Failure modes

An error about no matching overload nearly always means an integer where a float was wanted, or the reverse.

An error that an expression is not constant means a runtime value was used as an array size or in a `const`.

If a shader compiles but produces black, add a temporary `return vec4f(1,0,0,1)` at the top of the fragment shader to confirm it runs at all, then bisect downward. Since there is no printing from a shader, returning a colour is your printing.

## Resources

[webgpufundamentals.org, WGSL](https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl.html) is a concise tour that overlaps this note and is worth reading for a second phrasing.

The [WGSL specification](https://www.w3.org/TR/WGSL/) is the authority, and its built in function index is genuinely usable as a lookup table even though the surrounding text is not meant to be read start to finish.

[compute.toys](https://compute.toys/) lets you write and run WGSL compute shaders in the browser with no setup, which makes it a good scratchpad for trying language features in isolation.
