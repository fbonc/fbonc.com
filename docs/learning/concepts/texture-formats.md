# Texture formats

A format names a texture's channels, their bit depth, and how the stored bits are interpreted when a shader reads them.

In `rgba8unorm`, four channels of 8 bits each are stored, and `unorm` means the stored range of 0 to 255 is presented to the shader as a float from 0.0 to 1.0. In `rgba32uint` the four channels are raw 32 bit unsigned integers with no conversion, which is the natural choice for storing coordinates and indices. `r32float` is a single high precision channel, useful for a density or distance field.

The suffix determines the WGSL type of the texture. A `unorm`, `snorm` or `float` format is read as `texture_2d<f32>`, a `uint` format as `texture_2d<u32>`, and a `sint` format as `texture_2d<i32>`. Mismatching these is a validation error rather than a wrong value.

`rgba8unorm-srgb` applies gamma conversion on read and write. It matters for colour correctness in a full renderer and is a distraction otherwise, but mixing it up with the plain variant gives images that look subtly washed out or over contrasted, so pick one and be consistent.

The canvas format should come from `navigator.gpu.getPreferredCanvasFormat()`, and a render pipeline must declare the same format it will draw into.

For a [[storage-texture|storage texture]] the format is part of the type in the shader and must match the texture exactly, and only a subset of formats are permitted.

See [[10_textures-and-images|Textures and images]].
