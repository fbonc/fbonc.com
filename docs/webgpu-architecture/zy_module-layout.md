# Module layout

```
client/src/engine/
  core/        device.ts · clock.ts · engine.ts · particle-pool.ts · stats.ts
  behaviors/   behavior.ts · seek.wgsl · orbit.wgsl · explode.wgsl · relax.wgsl
  render/      renderer.ts · particle.wgsl
  stipple/     lloyd.ts · density.ts · sampler.ts · jfa.wgsl · centroid.wgsl
  targets/     provider.ts · html-provider.ts · stipple-provider.ts
  matching/    matcher.ts · morton.ts · random.ts
  director/    director.ts · scenes/ (intro-orbit.ts · text-morph.ts · stipple-cycle.ts)
  main.ts      capability gate → engine boot | static page
```

Maps to the subsystems: `core/` → [[01_particle-pool]], `behaviors/` →
[[02_behaviors]], `stipple/` → [[03_stipple-pipeline]], `render/` →
[[04_rendering]], `director/` → [[05_director-scenes]].
