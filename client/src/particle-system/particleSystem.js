import { clearCanvas } from "./canvas.js";


export class Particle {
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


export function spawnInRing({ centerX, centerY, innerRadius, outerRadius }) {
    return function spawn() {
        const angle = Math.random() * Math.PI * 2;
        const radius = (Math.random() * 100 + innerRadius) + Math.random() * (outerRadius - innerRadius);

        return {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
        };
    };
}


export function spawnOffscreenNearby({
    targetRC,
    margin = 50,
    maxDistanceExtra = 0,
    maxIterations = 100
}) {
    return function spawn(refX, refY) {
        const w = targetRC.canvas.clientWidth;
        const h = targetRC.canvas.clientHeight;
        const maxDistance = Math.min(w, h) + maxDistanceExtra;

        for (let i = 0; i < maxIterations; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const r = Math.sqrt(Math.random()) * maxDistance;
            const x = refX + Math.cos(angle) * r;
            const y = refY + Math.sin(angle) * r;

            if (x < -margin || x > w + margin || y < -margin || y > h + margin) {
                return { x, y };
            }
        }

        return { x: refX, y: -margin };
    };
}


export function samplePixelTargets({ sourceRC, samplePixels, stride }) {
    const pixels = samplePixels(sourceRC);
    const targets = [];

    for (let i = 0; i < pixels.length; i += stride) {
        const pixel = pixels[i];
        targets.push({
            targetX: pixel.x,
            targetY: pixel.y,
            targetColor: { r: pixel.r, g: pixel.g, b: pixel.b },
            targetRadius: 1,
        });
    }

    return targets;
}


export function createParticlesFromTargets({ targets, spawn }) {
    const particles = [];

    for (const target of targets) {
        const { x, y } = spawn(target.targetX, target.targetY);

        particles.push(
            new Particle(
                x, y,
                target.targetX, target.targetY,
                target.targetRadius, target.targetRadius,
                { ...target.targetColor }, { ...target.targetColor }
            )
        );
    }

    return particles;
}


export function renderParticles(particles, rc) {
    for (const p of particles) {
        rc.ctx.beginPath();
        rc.ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
        rc.ctx.fillStyle = `rgb(${p.color.r}, ${p.color.g}, ${p.color.b})`;
        rc.ctx.fill();
    }
}
