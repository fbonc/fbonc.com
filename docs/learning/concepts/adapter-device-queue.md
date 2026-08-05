# Adapter, device, queue

The three objects that stand between JavaScript and the GPU, obtained in a fixed order from `navigator.gpu`.

An adapter represents a physical GPU together with its driver. It is where you inspect capability, since `adapter.features` and `adapter.limits` describe what the hardware could do before you have committed to anything. Requesting one can resolve to `null` rather than rejecting, which is the check every capability gate needs.

A device is a logical connection to that adapter, and it is the object you actually use, since nearly everything is created by a method on it. Optional features and raised limits are requested at device creation and nowhere else, so anything you do not ask for is not enabled even when the hardware supports it. That is deliberate, because it keeps behaviour consistent across machines.

A queue, reached as `device.queue`, is the single path by which recorded work reaches the GPU. It also carries the direct data transfer methods, `writeBuffer` and `writeTexture`.

Both `requestAdapter` and `requestDevice` are asynchronous, which is why engine initialisation is unavoidably `async`.

See [[02_device-and-first-frame|Device and first frame]].
