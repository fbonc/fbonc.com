# Swapchain

The small rotating set of textures that a canvas hands out to be drawn into and then displays.

You never create these textures. Calling `context.configure({ device, format, alphaMode })` sets up the arrangement, and `context.getCurrentTexture()` returns the next one in the rotation. Two or three textures are typically in play, so that the GPU can be drawing one frame while another is being presented.

The practical consequence is that the texture is not yours to keep. Call `getCurrentTexture()` fresh every frame and never cache the view across frames, because the texture you were given last frame is very likely already on screen or being reused.

The format should come from `navigator.gpu.getPreferredCanvasFormat()` rather than being hardcoded, since using the platform's preferred format avoids a conversion on every presented frame. That same value must be declared as the render pipeline's target format.

Resizing the canvas by assigning `canvas.width` and `canvas.height` reallocates the swapchain textures automatically, so `configure()` does not need to be called again.

See [[02_device-and-first-frame|Device and first frame]] and [[device-pixel-ratio|device pixel ratio]].
