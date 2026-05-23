import { clearCanvas } from "./canvas.js";
import { renderParticles } from "./particleSystem.js";


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


function moveParticlesTowardsTarget(particles, speed) {
    let allArrived = true;

    for (const p of particles) {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > speed) {
            p.x += (dx / distance) * speed;
            p.y += (dy / distance) * speed;
            allArrived = false;
        } else {
            p.x = p.targetX;
            p.y = p.targetY;
        }
    }

    return allArrived;
}
