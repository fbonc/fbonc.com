import { captureElement, drawCapturedElement, samplePixels } from "./sample.js";

async function onResize() {
    const token = ++resizeToken;

    resizeCanvas(groundTruthRC);
    resizeCanvas(particleCanvasRC);

    clearCanvas(groundTruthRC);
    clearCanvas(particleCanvasRC);

    await nextFrame();

    if (token !== resizeToken) return;

    const captured = await captureElement(document.getElementById('biotext'));

    if (token !== resizeToken) return;

    clearCanvas(groundTruthRC);
    drawCapturedElement(groundTruthRC.ctx, captured);

    const textParticles = createTextParticles(groundTruthRC);

    if (token !== resizeToken) return;

    clearCanvas(particleCanvasRC);

    if (animationId != null) {
        cancelAnimationFrame(animationId);
    }
    draw(textParticles, particleCanvasRC);
}


class RenderingContext {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }
}

const groundTruthCanvas = document.getElementById('groundTruthCanvas');
const particleCanvas = document.getElementById('particleCanvas');

const groundTruthRC = new RenderingContext(
    groundTruthCanvas,
    groundTruthCanvas.getContext('2d', { willReadFrequently: true })
);

const particleCanvasRC = new RenderingContext(
    particleCanvas,
    particleCanvas.getContext('2d', { willReadFrequently: true })
);

const renderingContexes = [groundTruthRC, particleCanvasRC];



class Particle {
    constructor(x, y, targetX, targetY, radius, targetRadius, color, targetColor) {
        this.x = x;
        this.y = y;
        this.targetX = targetX;
        this.targetY = targetY;
        this.radius = radius;
        this.targetRadius = targetRadius;
        this.color = color;
        this.targetColor = targetColor;
    }
}


function clearCanvas(rc) {
    rc.ctx.clearRect(0, 0,
        rc.canvas.clientWidth,
        rc.canvas.clientHeight
    );
}


let resizeToken = 0;



function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}


function resizeCanvas(rc) {
    const dpr = window.devicePixelRatio || 1;

    rc.canvas.width = window.innerWidth * dpr;
    rc.canvas.height = window.innerHeight * dpr;

    rc.canvas.style.width = `${window.innerWidth}px`;
    rc.canvas.style.height = `${window.innerHeight}px`;

    rc.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}


function createTextParticles(rc) {
    const nonTransparentPixels = samplePixels(rc);
    const textParticles = [];

    const stride = 10;

    for (let i = 0; i < nonTransparentPixels.length; i += stride) {
        const x = Math.random() * particleCanvasRC.canvas.clientWidth;
        const y = Math.random() * particleCanvasRC.canvas.clientHeight;

        const targetX = nonTransparentPixels[i].x;
        const targetY = nonTransparentPixels[i].y;

        const { r, g, b } = nonTransparentPixels[i];

        textParticles.push(
            new Particle(x, y, targetX, targetY, 1, 1, `rgb(${r}, ${g}, ${b})`, `rgb(${r}, ${g}, ${b})`)
        );
    }

    return textParticles;
}

function renderParticles(particles, rc) {
    for (const p of particles) {
        rc.ctx.beginPath();
        rc.ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
        rc.ctx.fillStyle = p.color;
        rc.ctx.fill();
    }
}

let animationId = null;

function draw(particles, rc) {
    clearCanvas(rc);
    renderParticles(particles, rc);
    moveParticlesTowardsTarget(particles, 1);

    animationId = window.requestAnimationFrame(() => draw(particles, rc));
}


function moveParticlesTowardsTarget(particles, speed) {
    for (const p of particles) {
        const x = p.x;
        const y = p.y;
        const targetX = p.targetX;
        const targetY = p.targetY;

        const dx = targetX - x;
        const dy = targetY - y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > speed) {
            p.x += (dx / distance) * speed;
            p.y += (dy / distance) * speed;
        } else {
            p.x = targetX;
            p.y = targetY;
        }
    }
}


onResize();
window.addEventListener('resize', () => { onResize() });
