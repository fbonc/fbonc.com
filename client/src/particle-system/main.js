import { createRenderingContext } from "./canvas.js";
import { ParticleAnimator } from "./particleSystem.js";
import { handleResize } from "./resize.js";

const groundTruthRC = createRenderingContext("groundTruthCanvas", { willReadFrequently: true,});

const particleCanvasRC = createRenderingContext("particleCanvas", { willReadFrequently: true,});

const animator = new ParticleAnimator(particleCanvasRC);

const sourceElement = document.getElementById("biotext");
const particleCanvas = particleCanvasRC.canvas;
const FADE_DURATION_MS = 1000;
let fadeToken = 0;

if (!sourceElement) {
    throw new Error("Cannot find #biotext source element.");
}

function prepareParticleRun() {
    fadeToken++;

    sourceElement.style.transition = "none";
    sourceElement.style.visibility = "hidden";
    sourceElement.style.opacity = "0";
    sourceElement.style.pointerEvents = "none";

    particleCanvas.style.transition = "none";
    particleCanvas.style.visibility = "visible";
    particleCanvas.style.opacity = "1";
}

function fadeToHtml() {
    const token = ++fadeToken;

    sourceElement.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    sourceElement.style.visibility = "visible";
    sourceElement.style.pointerEvents = "";

    particleCanvas.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    particleCanvas.style.visibility = "visible";

    requestAnimationFrame(() => {
        if (token !== fadeToken) return;

        sourceElement.style.opacity = "1";
        particleCanvas.style.opacity = "0";
    });

    setTimeout(() => {
        if (token !== fadeToken) return;
        particleCanvas.style.visibility = "hidden";
    }, FADE_DURATION_MS);
}

async function resize() {
    prepareParticleRun();
    await handleResize({ groundTruthRC, particleCanvasRC, animator, sourceElement, onParticlesArrived: fadeToHtml});
}

resize();

let resizeTimeout = null;

window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => { resize(); }, 100);
});

window.addEventListener("resize", resize);
