# Bind group and layout

The mechanism by which a shader is given access to buffers, textures, and samplers. A resource that merely exists is invisible to a shader until it is bound.

The model has two halves, and the split is the same idea as a type and a value. A bind group layout is the contract, saying that binding 0 is a uniform buffer, binding 1 is a read only storage buffer, and which shader stages may see each. A bind group is an instance of that contract, naming the actual resources. Validation happens once against the layout, so swapping which resources are in use is cheap.

In WGSL a binding is addressed by two numbers, `@group(n) @binding(m)`. Up to four groups may be bound at once, and the reason to use more than one is update frequency, keeping slow changing resources in group 0 and per draw resources in a higher group so only what changed is rebound.

`layout: 'auto'` on a pipeline infers the layout from the shader source and is correct until you need to share a bind group between pipelines, at which point it becomes the problem. Automatic layouts are unique to their pipeline, so a bind group created from one pipeline's layout cannot be used with another, and automatic layouts cannot declare dynamic offsets. Both limits eventually push a real engine toward explicit layouts.

An inferred layout only includes bindings the shader actually references, so removing a use of a buffer while debugging silently changes the layout and produces a confusing mismatch.

See [[04_buffers-and-bind-groups|Buffers and bind groups]].
