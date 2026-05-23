import { resizeCanvas, clearCanvas } from "./canvas.js";
import { captureElement, drawCapturedElement, samplePixels } from "./sample.js";
import { createTextParticles } from "./particleSystem.js";
import { nextFrame } from "./utils.js";

let resizeToken = 0;

export async function handleResize({groundTruthRC, particleCanvasRC, animator, sourceElement, onParticlesArrived}) {
    const token = ++resizeToken;

    animator.stop();

    resizeCanvas(groundTruthRC);
    resizeCanvas(particleCanvasRC);

    clearCanvas(groundTruthRC);
    clearCanvas(particleCanvasRC);

    await nextFrame();
    await nextFrame();

    if (token !== resizeToken) return;

    const captured = await captureElement(sourceElement);

    if (token !== resizeToken) return;

    clearCanvas(groundTruthRC);
    drawCapturedElement(groundTruthRC.ctx, captured);

    const textParticles = createTextParticles({
        sourceRC: groundTruthRC,
        targetRC: particleCanvasRC,
        samplePixels,
    });

    if (token !== resizeToken) return;

    clearCanvas(particleCanvasRC);
    animator.start(textParticles, {
        onComplete: () => {
            if (token !== resizeToken) return;
            onParticlesArrived?.();
        },
    });
}
