# Overview

An ordered, end-to-end course in WebGPU, written for someone who has never touched a graphics API.

The scope is fixed by a single question: what do you need to understand in order to build a GPU particle engine that morphs text and stipples images in real time. Everything required for that is here. Nothing else is. There is no Direct3D history, no discussion of ray tracing, no tessellation or geometry shaders, no 3D camera matrices, because this project renders flat quads in two dimensions and never needs them.

Nothing in this directory is specific to this project's codebase. The notes teach WebGPU and the algorithms the project runs on top of it, using neutral examples. For how those pieces are wired together into an actual engine, see [[02_webgpu-architecture|the architecture notes]], and for the project's own milestone ladder see [[03_learning-path|the learning path]].

## How to use this

Read in order. Each note assumes every note before it and nothing after it.

Every note ends with a checkpoint, a small self-contained program you can actually run. Build it. The checkpoints are cumulative in concept but independent in code, so each one stands alone in a single file and none of them depend on a framework. Reading about a binding model teaches you very little, and spending twenty minutes debugging a bind group that does not match its layout teaches you a lot.

You need Chrome or Edge 113 or newer, or Safari 26 or newer, and a text editor. Serve the files over `http://localhost` rather than opening them as `file://` URLs, since some browsers restrict the API on file origins. Any static server will do.

## Sequence

**Part I, foundations.** How the machine works and how to talk to it at all.

1. [[01_gpu-mental-model|The GPU mental model]], what a GPU actually is, why it is a separate machine, and why that shapes every decision downstream.
2. [[02_device-and-first-frame|Device and first frame]], the handshake from `navigator.gpu` to a canvas full of colour.
3. [[03_shaders-and-render-pipeline|Shaders and the render pipeline]], the vertex and fragment stages, and your first triangle.
4. [[04_buffers-and-bind-groups|Buffers and bind groups]], getting your data onto the GPU and making a shader able to see it.
5. [[05_wgsl-language-tour|WGSL language tour]], the shading language itself, as a language.
6. [[06_memory-layout-and-alignment|Memory layout and alignment]], the single most common source of silent, invisible corruption.

**Part II, the two pipelines.** The render path and the compute path in earnest.

7. [[07_instanced-drawing-and-sdf-circles|Instanced drawing and SDF circles]], one draw call for a hundred thousand particles.
8. [[08_compute-shaders|Compute shaders]], running arbitrary parallel work with no triangles involved.
9. [[09_parallel-patterns|Parallel patterns]], reductions, atomics, scatter with collisions, and ping-pong.
10. [[10_textures-and-images|Textures and images]], loading pixels in, computing into them, and reading them back out.

**Part III, operating an engine.** Making it run continuously, correctly, and fast.

11. [[11_frame-loop-and-readback|Frame loop and readback]], timing, motion, asynchrony, and getting data back from the GPU.
12. [[12_debugging-and-performance|Debugging and performance]], what to do when there is no `console.log`.

**Part IV, the algorithms.** GPU implementations of the specific techniques this project is built from.

13. [[13_density-and-rejection-sampling|Density and rejection sampling]], turning an image into a cloud of points.
14. [[14_voronoi-and-jump-flooding|Voronoi and jump flooding]], nearest-seed diagrams in logarithmic time.
15. [[15_lloyd-relaxation|Lloyd relaxation]], iterating a point cloud into an even, organic distribution.
16. [[16_spatial-ordering-and-matching|Spatial ordering and matching]], Morton codes and coherent particle assignment.

## Atomic notes

Definitions of individual concepts live in [[concepts/00_index|concepts]] and are linked from the sequence as they come up. They are written to be read out of order and revisited, so use them as a reference rather than a reading list.

## Primary resources

[webgpufundamentals.org](https://webgpufundamentals.org/) is the best introduction that exists and covers a large fraction of what follows. Where a note has a corresponding article there, it is linked directly.

The [WebGPU specification](https://www.w3.org/TR/webgpu/) and the [WGSL specification](https://www.w3.org/TR/WGSL/) are reference material, not reading. You will use the WGSL alignment tables often enough to bookmark them.

[webgpu.github.io/webgpu-samples](https://webgpu.github.io/webgpu-samples/) is working code for most standard techniques, and [MDN's WebGPU API pages](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) are a reliable per-method reference.
