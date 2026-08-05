# Rendering

- One instanced draw: 4-vertex quad × alive capacity. The vertex shader reads the [[01_particle-pool|`Particle` storage buffer]] directly by `instance_index` (no vertex-buffer copies), and the fragment shader draws an SDF circle with soft edge.
- Single visible canvas. DOM capture for text sampling uses an OffscreenCanvas (CPU-side, never displayed).
- Premultiplied alpha over the page background, DPR-aware, and `resize` regenerates canvas config and re-requests TargetSets.
