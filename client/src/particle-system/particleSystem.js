import { clearCanvas } from "./canvas.js";
import { Particle, renderParticles, moveParticlesTowardsTarget } from "./particle.js";

export function createTextParticles({ sourceRC, targetRC, samplePixels }) {
    const pixels = samplePixels(sourceRC);
    const particles = [];

    const stride = 15;

    for (let i = 0; i < pixels.length; i += stride) {
        const pixel = pixels[i];

        const x = Math.random() * targetRC.canvas.clientWidth;
        const y = Math.random() * targetRC.canvas.clientHeight;

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
    }

    start(particles, { onComplete } = {}) {
        this.stop();

        const draw = () => {
            clearCanvas(this.rc);

            const allArrived = moveParticlesTowardsTarget(particles, this.speed);
            renderParticles(particles, this.rc);

            if (allArrived) {
                this.stop();
                onComplete?.();
                return;
            }

            this.animationId = requestAnimationFrame(draw);
        };

        draw();
    }

    stop() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}
