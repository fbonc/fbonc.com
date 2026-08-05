# Behaviors (simulation)

A behavior is a WGSL module implementing one function over a particle, plus a typed params struct:

```
seek.wgsl      accelerate/ease toward target, arrival snapping
orbit.wgsl     breath/wobble/twist idle orbit (port of current look)
explode.wgsl   radial impulse + decay
relax.wgsl     gentle seek toward continuously-updated Lloyd centroids
```

- The engine composes the active behaviors into compute pipelines. Each particle runs the behavior selected by its [[01_particle-pool|`group`]], so cohorts can do different things simultaneously (text particles seeking while ambient particles orbit) in a single dispatch.
- All motion is dt-integrated (px/s, clamped dt), so it is frame-rate independent.
- Shared post-step (progress lerp of color/radius, arrival stats) runs in the same pass after the behavior step.

Adding a behavior means one WGSL file plus a params interface, with no engine changes (see [[zz_extension-points]]).

The `relax` behavior is driven by the [[03_stipple-pipeline|stipple pipeline]]: its moving targets are the live Lloyd centroids.
