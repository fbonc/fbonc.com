import { createRenderingContext, resizeCanvas, clearCanvas } from "./canvas.js";
import { createTextParticles, renderParticles } from "./particleSystem.js";
import { ParticleAnimator, moveParticlesTowardsTarget, moveParticlesInCircle } from "./animator.js";
import { explodeParticles, moveParticlesInOrbit } from "./animator.js";
import { drawElement, samplePixels } from "./sampleElement.js";
import { hideElement, showElement, hideCanvas } from "./utils.js";
import { fadeOut, pulseOpacity, fadeIn } from "./utils.js";


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


function randomOrbitArgs() {
    const rand = (min, max) => min + Math.random() * (max - min);
    const randInt = (min, max) => Math.floor(rand(min, max + 1));

    return {
        breathAmount: rand(0.15, 0.4),
        breathSpeed: rand(0.0005, 0.0015),
        ripple: rand(0.015, 0.05) * (Math.random() < 0.2 ? -1 : 1),
        wobbleAmount: rand(0.3, 0.7),
        wobbleHarmonic: randInt(2, 7),
        twist: rand(-0.6, 0.6)
    };
}

const clickAnywhereEl = document.getElementById("clickanywhere");


const groundTruthRC = createRenderingContext("groundTruthCanvas", { willReadFrequently: true, });
const particleCanvasRC = createRenderingContext("particleCanvas", { willReadFrequently: true, });


const sourceElement = document.getElementById("biotext");

const textParticles = await initializeParticles();


const particlesOrbitAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: moveParticlesInOrbit,
    speed: 1,
    animationArgs: randomOrbitArgs(),
})

startAnimator(particlesOrbitAnimator);
fadeIn(particleCanvasRC.canvas, FADE_DURATION_MS);
fadeIn(clickAnywhereEl, FADE_DURATION_MS, "block", 0.8).then(() => {
    pulseOpacity(clickAnywhereEl, {minOpacity: 0.4, maxOpacity: 0.8, duration: 3000});
});

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
    speed: 3,
    animationArgs: {
        stopThreshold: 0.1,
        deceleration: 0.97
    }
});

window.addEventListener("click", () => {
    startAnimator(explodeParticlesAnimator);
    fadeOut(clickAnywhereEl, 1000);
});
