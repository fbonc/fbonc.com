# Director & scenes

The Director replaces `main.js` callback chaining with an explicit state machine. Scenes are data + hooks, not loops:

```
StippleCycle scene:
  GATHER   assign(next image initial samples, Morton match) → seek
  RELAX    LloydModule active, relax behavior          (fixed duration / convergence ε)
  HOLD     idle micro-motion (optional)
  DEPART   transition style (pluggable):
             direct  → GATHER(next image)
             explode → explode behavior, then GATHER(next image)
  … repeat over image playlist
```

`TextMorph` and `IntroOrbit` reproduce today's page flow (see [[01_current-architecture]]) using the same [[01_particle-pool|pool]]. Particles migrate freely between cohorts because a transition is just re-`group` plus new assignment plus [[02_behaviors|behavior]] switch. A particle leaving the nav text to join a stippled figure gets `startColor = current`, `targetColor = figure color`, and the progress lerp handles the rest.

Phase advances are driven by real arrival stats read back from the [[01_particle-pool|pool]], not timers. RELAX targets come from the [[03_stipple-pipeline|stipple pipeline]].
