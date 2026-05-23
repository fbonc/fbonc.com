import { clearCanvas } from "./canvas.js";
import { renderParticles } from "./particleSystem.js";


export class ParticleAnimator {
    constructor({ rc, particles, animation, onComplete = null, speed = 5 }) {
        this.rc = rc;
        this.particles = particles;
        this.animation = animation;
        this.onComplete = onComplete;
        this.speed = speed;

        this.animationId = null;

        this.draw = this.draw.bind(this);
    }

    start() {
        this.stop();
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

        const allArrived = this.animation(this.particles, this.speed);
        renderParticles(this.particles, this.rc);

        if (allArrived) {
            this.stop();
            this.onComplete?.();
            return;
        }

        this.animationId = requestAnimationFrame(this.draw);
    }
}


export function moveParticlesTowardsTarget(particles, speed) {
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


export function moveParticlesInCircle(particles, speed) {

    const centerX = targetRC.canvas.clientWidth / 2;
    const centerY = targetRC.canvas.clientHeight / 2;

    for (const p of particles) {

        
    }

    return false;
}









