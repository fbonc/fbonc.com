# Data model: `ParticlePool`

The single source of truth for particle state: fixed-capacity GPU storage buffers. No per-frame CPU↔GPU particle traffic. CPU writes happen only at transitions (assignment upload).

```
struct Particle {          // storage buffer, array<Particle, CAPACITY>
  pos       : vec2f
  vel       : vec2f
  startPos  : vec2f        // journey origin (progress lerp)
  target    : vec2f
  radius    : f32
  targetRadius : f32
  color     : u32          // packed rgba8 — current
  startColor : u32
  targetColor : u32
  group     : u32          // cohort id: AMBIENT | TEXT | STIPPLE | DEAD…
  scratch   : vec4f        // behavior-owned (orbit angle, explode vel, …)
}
```

- **Journey progress** `t = 1 − dist(pos, target) / dist(startPos, target)` (clamped, eased) drives color and radius interpolation in the sim shader, with no per-frame CPU involvement, so arrival color is exact by construction.
- **Death** = radius shrink to 0 + `group = DEAD`. Dead slots are free-listed on the CPU and reused at the next assignment. No compaction needed, since the renderer emits degenerate quads for dead particles.
- **Stats buffer**: a small storage buffer (arrived count per group) reduced each frame, read back asynchronously (`mapAsync`, ~1–2 frames latency) so the [[05_director-scenes|Director]] can advance phases on real arrival, not timers.

The `scratch` field is owned by whichever [[02_behaviors|behavior]] a particle's `group` selects. Progress lerp and arrival stats are computed in the shared post-step described in [[02_behaviors]].
