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


export function createTextParticles({ sourceRC, targetRC, samplePixels }) {
    const pixels = samplePixels(sourceRC);
    const particles = [];

    const stride = 10;

    const centerX = targetRC.canvas.clientWidth / 2;
    const centerY = targetRC.canvas.clientHeight / 2;

    const innerRadius = 250;
    const outerRadius = 300;

    for (let i = 0; i < pixels.length; i += stride) {
        const pixel = pixels[i];

        const angle = Math.random() * Math.PI * 2;
        const radius = (Math.random() * 100 + innerRadius) + Math.random() * (outerRadius - innerRadius);

        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;

        // const x = Math.random() * targetRC.canvas.clientWidth;
        // const y = Math.random() * targetRC.canvas.clientHeight;

        const targetX = pixel.x;
        const targetY = pixel.y;
        const { r, g, b } = pixel;

        particles.push(
            new Particle(x, y, targetX, targetY, 1, 1, `rgb(${r}, ${g}, ${b})`, `rgb(${r}, ${g}, ${b})`));
    }

    return particles;
}


export function renderParticles(particles, rc) {
    for (const p of particles) {
        rc.ctx.beginPath();
        rc.ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
        rc.ctx.fillStyle = p.color;
        rc.ctx.fill();
    }
}