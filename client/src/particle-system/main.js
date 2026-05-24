import { createRenderingContext, resizeCanvas, clearCanvas } from "./canvas.js";
import { createTextParticles, renderParticles } from "./particleSystem.js";
import { ParticleAnimator, moveParticlesTowardsTarget, moveParticlesInCircle, explodeParticles } from "./animator.js";
import { drawElement, samplePixels } from "./sampleElement.js";
import { hideElement, showElement, hideCanvas } from "./utils.js";


export let activeAnimator = null;

async function startAnimator(animator) {
    await activeAnimator?.stop();
    activeAnimator = animator;
    animator.start();
}


export const FADE_DURATION_MS = 1000;

function fadeToHtml(el, c) {
    showElement(el);
    hideCanvas(c);
}


async function initializeParticles() {
    resizeCanvas(groundTruthRC);
    resizeCanvas(particleCanvasRC);

    clearCanvas(groundTruthRC);
    clearCanvas(particleCanvasRC);

    await drawElement(sourceElement, groundTruthRC);

    const textParticles = createTextParticles({
        sourceRC: groundTruthRC,
        targetRC: particleCanvasRC,
        samplePixels,
    });

    clearCanvas(particleCanvasRC);
    renderParticles(textParticles, particleCanvasRC);

    hideElement(sourceElement);

    return textParticles;
}


const groundTruthRC = createRenderingContext("groundTruthCanvas", { willReadFrequently: true, });
const particleCanvasRC = createRenderingContext("particleCanvas", { willReadFrequently: true, });


const sourceElement = document.getElementById("biotext");
if (!sourceElement) {
    throw new Error("Cannot find #biotext source element.");
}

const textParticles = await initializeParticles();

const particlesCircleAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: moveParticlesInCircle,
    speed: 3,
    smoothStop: true,
    stopDuration: 1000
});

startAnimator(particlesCircleAnimator);

const particlesToTextAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: moveParticlesTowardsTarget,
    onComplete: () => {
        fadeToHtml?.(sourceElement, particleCanvas);
    },
    speed: 10,
    animationArgs: {
        minSpeed: 0.01,
        accelerationDistance: 120,
        arrivalThreshold: 0.5,
        speedSmoothing: 0.005
    }
});

const explodeParticlesAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: explodeParticles,
    onComplete: () => {
        startAnimator(particlesToTextAnimator);
    },
    speed: 5,
    animationArgs: {
        stopThreshold: 0.05
    }
});

window.addEventListener("click", () => {
    startAnimator(explodeParticlesAnimator);
});
