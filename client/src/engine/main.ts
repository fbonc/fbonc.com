export {}

const canvas = document.querySelector<HTMLCanvasElement>('#webgpu');
if (!canvas || !navigator.gpu) throw new Error('WebGPU is unavailable');

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter');

const device = await adapter.requestDevice();

const maybeContext = canvas.getContext('webgpu');
if (!maybeContext) throw new Error('Could not create WebGPU canvas context');
const context = maybeContext;

const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'premultiplied' });

device.addEventListener('uncapturederror', (event) => {
  console.error(event.error.message);
});
device.lost.then((info) => console.error('WebGPU device lost:', info.message));

new ResizeObserver(([entry]) => {
  const size = entry.contentBoxSize[0];
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.floor(size.inlineSize * dpr));
  canvas.height = Math.max(1, Math.floor(size.blockSize * dpr));
}).observe(canvas);

function frame() {
  const encoder = device.createCommandEncoder({ label: 'frame encoder' });
  const pass = encoder.beginRenderPass({
    label: 'clear pass',
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.03, g: 0.03, b: 0.05, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);