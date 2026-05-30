import { createRenderingContext, resizeCanvas } from "./canvas.js";

import { createParticlesFromTargets, renderParticles, samplePixelTargets } from "./particleSystem.js";
import { spawnInRing, spawnOffscreenNearby } from "./particleSystem.js";

import { ParticleAnimator, moveParticlesTowardsTarget, moveParticlesInCircle } from "./animator.js";
import { explodeParticles, moveParticlesInOrbit } from "./animator.js";

import { drawElement, samplePixels } from "./sampleElement.js";

import { hideElement, clearCanvas } from "./utils.js";
import { fadeOut, pulseOpacity, fadeIn, fadeInCanvas } from "./utils.js";

import { assignTransitionTargets, fadeToHtml } from "./transition.js";


export const FADE_DURATION_MS = 1000;

const PARTICLE_STRIDE = 10;
const OFFSCREEN_MARGIN = 50;
const OFFSCREEN_MAX_DISTANCE_EXTRA = 0;


export let activeAnimator = null;

async function startAnimator(animator) {
    await activeAnimator?.stop();
    activeAnimator = animator;
    animator.start();
}

async function precaptureElementTargets(elements) {
    const targetsByElement = new Map();

    for (const el of elements) {
        await drawElement(el, groundTruthRC);
        const targets = samplePixelTargets({
            sourceRC: groundTruthRC,
            samplePixels,
            stride: PARTICLE_STRIDE,
        });
        targetsByElement.set(el, targets);
    }

    return targetsByElement;
}


async function initializeParticles() {
    resizeCanvas(groundTruthRC);
    resizeCanvas(particleCanvasRC);

    clearCanvas(groundTruthRC);
    clearCanvas(particleCanvasRC);

    const elementTargets = await precaptureElementTargets([biotextEl, projectstextEl, othertextEl]);

    const textParticles = createParticlesFromTargets({
        targets: elementTargets.get(currentElement),
        spawn: spawnInRing({
            centerX: particleCanvasRC.canvas.clientWidth / 2,
            centerY: particleCanvasRC.canvas.clientHeight / 2,
            innerRadius: 175,
            outerRadius: 200,
        }),
    });

    clearCanvas(particleCanvasRC);
    renderParticles(textParticles, particleCanvasRC);

    return { textParticles, elementTargets };
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


const biotextEl = document.getElementById("biotext");
const projectstextEl = document.getElementById("projectstext");
const othertextEl = document.getElementById("othertext");

let currentElement = biotextEl;

const { textParticles, elementTargets } = await initializeParticles();


const particlesOrbitAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: moveParticlesInOrbit,
    speed: 1,
    animationArgs: randomOrbitArgs(),
})

let clickAnywhereDismissed = false;

startAnimator(particlesOrbitAnimator);
fadeIn(particleCanvasRC.canvas, FADE_DURATION_MS);
fadeIn(clickAnywhereEl, FADE_DURATION_MS, "block", 0.8).then(() => {
    if (clickAnywhereDismissed) return;
    pulseOpacity(clickAnywhereEl, { minOpacity: 0.4, maxOpacity: 0.8, duration: 3000 });
});

const particlesToTextAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: moveParticlesTowardsTarget,
    onComplete: () => {
        fadeToHtml?.(currentElement, particleCanvasRC.canvas);
    },
    speed: 15,
    animationArgs: {
        minSpeed: 0.01,
        accelerationDistance: 120,
        arrivalThreshold: 0.5,
        speedSmoothing: 0.005,
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
        deceleration: 0.97,
    }
});

const transitionAnimator = new ParticleAnimator({
    rc: particleCanvasRC,
    particles: textParticles,
    animation: moveParticlesTowardsTarget,
    onComplete: () => {
        fadeToHtml(currentElement, particleCanvasRC.canvas);
    },
    speed: 150,
    animationArgs: {
        minSpeed: 0.01,
        accelerationDistance: 150,
        arrivalThreshold: 0.5,
        speedSmoothing: 0.005,
        colorLerpRate: 0.06,
        radiusLerpRate: 0.06,
        cullOffscreen: true,
        cullMargin: OFFSCREEN_MARGIN / 2,
    }
});


async function transitionToElement(newElement) {
    await activeAnimator?.stop();

    assignTransitionTargets({
        particles: textParticles,
        targets: elementTargets.get(newElement),
        spawnBirth: spawnOffscreenNearby({
            targetRC: particleCanvasRC,
            margin: OFFSCREEN_MARGIN,
            maxDistanceExtra: OFFSCREEN_MAX_DISTANCE_EXTRA,
        }),
        chooseDeathPos: spawnOffscreenNearby({
            targetRC: particleCanvasRC,
            margin: OFFSCREEN_MARGIN,
            maxDistanceExtra: OFFSCREEN_MAX_DISTANCE_EXTRA,
        }),
        bornRadius: 1,
    });

    clearCanvas(particleCanvasRC);
    renderParticles(textParticles, particleCanvasRC);

    await Promise.all([
        fadeOut(currentElement, FADE_DURATION_MS),
        fadeInCanvas(particleCanvasRC.canvas, FADE_DURATION_MS),
    ]);

    currentElement = newElement;

    startAnimator(transitionAnimator);
}


function bindTransition(buttonId, targetElement) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener("click", (event) => {
        event.stopPropagation();
        transitionToElement(targetElement);
    });
}


bindTransition("projectsBtn", projectstextEl);
bindTransition("otherBtn", othertextEl);
bindTransition("backFromProjectsBtn", biotextEl);
bindTransition("backFromOtherBtn", biotextEl);


async function activate() {
    clickAnywhereDismissed = true;
    startAnimator(explodeParticlesAnimator);
    await fadeOut(clickAnywhereEl, 1000);
}


window.addEventListener("click", async () => { activate(); });
window.addEventListener("keydown", async (event) => { if (event.code === "Space") activate(); });