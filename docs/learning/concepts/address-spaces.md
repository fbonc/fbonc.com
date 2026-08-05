# Address spaces

A WGSL variable's address space says where its memory lives, who can see it, and whether it can be written.

`uniform` is small, read only, and shared identically by every invocation. It is the parameter block, and it carries an extra layout constraint, since array element strides must be a multiple of 16 bytes there.

`storage` is large, and takes an access mode of `read` or `read_write`. It is the only space a shader can write into for output, and a fragment shader may not write to it in core WebGPU, which is why all bulk read and write work belongs in compute.

`workgroup` is memory shared by the invocations of a single [[workgroup|workgroup]] and destroyed when they finish. It is fast, small, and needs a [[workgroup-barrier|barrier]] to be used safely.

`private` is per invocation module scope storage, and `function` is the implicit space of ordinary local variables.

```wgsl
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> targets: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
var<workgroup> tile: array<f32, 64>;
```

Runtime sized arrays, written `array<T>` with no length, are permitted only in the storage space, where the length comes from the bound buffer size and `arrayLength` reports it.

See [[05_wgsl-language-tour|WGSL language tour]].
