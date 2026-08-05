# Concepts index

Atomic definitions linked from the [[learning/00_overview|learning sequence]]. Each note covers one idea, is written to be read on its own, and points at the sequence note that teaches it in context.

This is a reference, not a reading list. Read the sequence, and come here when a term needs pinning down.

## API objects

- [[adapter-device-queue|Adapter, device, queue]], the three objects between you and the GPU.
- [[swapchain|Swapchain]], the rotating set of textures the canvas draws into.
- [[command-encoder|Command encoder]], how work is recorded and submitted.
- [[gpubuffer|GPUBuffer]], a flat block of GPU memory.
- [[buffer-usage-flags|Buffer usage flags]], what a buffer is permitted to do.
- [[bind-group-layout|Bind group and layout]], how a shader is given access to resources.
- [[buffer-mapping|Buffer mapping]], the asynchronous route from GPU memory to JavaScript.
- [[error-scopes|Error scopes]], attributing a validation error to the code that caused it.

## Memory and layout

- [[address-spaces|Address spaces]], where a shader variable lives and who can write it.
- [[typed-array-views|Typed array views]], building struct bytes in JavaScript.
- [[fixed-point-accumulation|Fixed point accumulation]], summing floats with integer atomics.

## Compute

- [[workgroup|Workgroup]], the unit of scheduling and sharing in a compute dispatch.
- [[dispatch-math|Dispatch math]], turning an item count into a workgroup count.
- [[workgroup-barrier|Workgroup barrier]], synchronising invocations within a workgroup.
- [[atomics|Atomics]], indivisible read modify write operations.
- [[ping-pong-buffering|Ping-pong buffering]], iterating without reading what you are writing.

## Rendering

- [[clip-space|Clip space]], the coordinate system a vertex shader must output.
- [[device-pixel-ratio|Device pixel ratio]], CSS pixels against real pixels.
- [[instancing|Instancing]], drawing many copies of one shape in a single call.
- [[vertex-pulling|Vertex pulling]], reading geometry from a storage buffer instead of a vertex buffer.
- [[signed-distance-function|Signed distance function]], defining a shape by distance rather than geometry.
- [[smoothstep|Smoothstep]], the eased interpolation used for antialiased edges.
- [[premultiplied-alpha|Premultiplied alpha]], the blending convention worth standardising on.

## Textures

- [[texture-formats|Texture formats]], what the channels are and how they are interpreted.
- [[sampler|Sampler]], filtering and edge handling for texture reads.
- [[storage-texture|Storage texture]], a texture a compute shader can write into.

## Algorithms

- [[centroidal-voronoi-tessellation|Centroidal Voronoi tessellation]], the fixed point Lloyd relaxation converges to.
- [[jump-flooding|Jump flooding]], an approximate Voronoi labelling in logarithmic passes.
- [[morton-code|Morton code]], interleaved bits as a locality preserving sort key.
