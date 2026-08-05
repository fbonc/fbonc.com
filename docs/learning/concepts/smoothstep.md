# Smoothstep

`smoothstep(edge0, edge1, x)` returns 0 below `edge0`, 1 above `edge1`, and an eased interpolation between them with zero slope at both ends.

It is the standard tool for antialiasing in a fragment shader. A hard threshold on a [[signed-distance-function|distance value]] gives visibly jagged edges, and a linear ramp gives a slightly harsh transition, while smoothstep's flat endpoints blend into the surrounding areas invisibly.

```wgsl
let d = length(local);
let w = 1.0 / max(radius, 1.0);        // one pixel, in local units
let alpha = 1.0 - smoothstep(1.0 - w, 1.0, d);
```

The important detail is that the fade width should correspond to a constant number of screen pixels rather than a constant distance in shader space. Otherwise small shapes look blurry and large ones look hard, since the same fade covers a different number of pixels in each case.

The related functions are `step`, which is the hard threshold, `mix` for plain linear interpolation, and `clamp`. All of them are branchless, which is the other reason shader code uses them so heavily.

Smoothstep is also useful outside antialiasing, as an easing curve for animation, since applying it to a progress value from 0 to 1 gives motion that accelerates and settles rather than starting and stopping abruptly.

See [[07_instanced-drawing-and-sdf-circles|Instanced drawing and SDF circles]].
