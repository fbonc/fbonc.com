import { createRenderingContext } from "./canvas.js";
import { ParticleAnimator } from "./particleSystem.js";
import { handleResize } from "./resize.js";

const groundTruthRC = createRenderingContext("groundTruthCanvas", {
    willReadFrequently: true,
});

const particleCanvasRC = createRenderingContext("particleCanvas", {
    willReadFrequently: true,
});

const animator = new ParticleAnimator(particleCanvasRC);

const sourceElement = document.getElementById("biotext");

async function resize() {
    await handleResize({
        groundTruthRC,
        particleCanvasRC,
        animator,
        sourceElement,
    });
}

resize();

let resizeTimeout = null;

window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);

    resizeTimeout = setTimeout(() => {
        resize();
    }, 100);
});