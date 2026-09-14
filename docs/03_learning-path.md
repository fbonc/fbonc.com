# Learning path: start building the WebGPU engine

The complete working guide is [[learning/00_overview|Start here: WebGPU particle engine]]. It contains the setup, first runnable frame, minimum WebGPU model, project algorithms, debugging checklist, and staged implementation order.

Read [[02_webgpu-architecture|the architecture overview]] first so the destination is clear. Then work through these checkpoints:

1. A separate `/webgpu.html` development page clears and resizes a WebGPU canvas.
2. One instanced draw renders a fixed GPU buffer of soft circles.
3. One compute pass moves the particles before the render pass.
4. A particle pool supports group-selected seek, orbit, and explode behaviors.
5. DOM capture and Morton matching reproduce the text morph flow.
6. Image density and rejection sampling produce initial stipple targets.
7. JFA and weighted Lloyd relaxation animate the stipple into an even distribution.
8. The Director integrates the text and image scenes into the real page.

Build each checkpoint before studying the next. The first three contain nearly all of the WebGPU surface area the engine needs; the remaining work applies those same patterns to the design in `docs/webgpu-architecture/`.
