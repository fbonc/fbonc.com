import { clearCanvas } from "./canvas.js";
import { Particle, renderParticles, moveParticlesTowardsTarget } from "./particle.js";

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

export class ParticleAnimator {
    constructor(rc) {
        this.rc = rc;
        this.animationId = null;
        this.speed = 5;

        this.particles = [];
        this.onComplete = null;

        this.draw = this.draw.bind(this);
    }

    start(particles, { onComplete } = {}) {
        this.stop();

        this.particles = particles;
        this.onComplete = onComplete;``

        this.draw();
    }

    stop() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    draw() {
        clearCanvas(this.rc);

        const allArrived = moveParticlesTowardsTarget(this.particles, this.speed);
        renderParticles(this.particles, this.rc);

        if (allArrived) {
            this.stop();
            this.onComplete?.();
            return;
        }

        this.animationId = requestAnimationFrame(this.draw);
    }
}
