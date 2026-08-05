# Typed array views

Several typed arrays over one `ArrayBuffer`, which is how a struct with mixed field types is assembled in JavaScript.

A single `Float32Array` cannot express a struct containing both `f32` and `u32` fields, since writing an integer through a float view stores its floating point encoding rather than its bits. Overlapping views solve it.

```js
const bytes = new ArrayBuffer(32);
const f32 = new Float32Array(bytes);
const u32 = new Uint32Array(bytes);

f32[0] = 1920;
u32[3] = 100000;
```

Index 3 addresses byte offset 12 in both views because both element types are 4 bytes wide. That coincidence holds for `f32`, `u32` and `i32` and breaks for anything else, so `DataView` is the safer tool when a layout mixes widths.

The discipline that matters is to derive every index from a computed layout rather than writing byte offsets as literals. A layout constant that exists in two places will eventually exist in two different states, and the resulting corruption is silent.

See [[06_memory-layout-and-alignment|Memory layout and alignment]].
