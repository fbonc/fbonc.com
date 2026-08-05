# Extension points

| To add…                                   | Touch                                                   |
| ----------------------------------------- | ------------------------------------------------------- |
| A new motion behavior                     | `behaviors/*.wgsl` + params type (see [[02_behaviors]]) |
| A new target source (SVG, video frame, …) | implement `TargetProvider`                              |
| A new matching strategy                   | implement `Matcher`                                     |
| A new transition style between images     | implement `TransitionStyle` (behavior sequence)         |
| A new page flow                           | implement `Scene` (see [[05_director-scenes]])          |

File locations for each are in [[zy_module-layout]].
