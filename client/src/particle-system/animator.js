import { clearCanvas } from "./canvas.js";
import { renderParticles } from "./particleSystem.js";


export class ParticleAnimator {
    constructor({ rc, particles, animation, onComplete = null, speed = 5, animationArgs = {} }) {
        this.rc = rc;
        this.particles = particles;
        this.animation = animation;
        this.onComplete = onComplete;
        this.speed = speed;
        this.animationArgs = animationArgs;

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

        const allArrived = this.animation({
            particles: this.particles,
            speed: this.speed,
            rc: this.rc,
            ...this.animationArgs
        });
       
        renderParticles(this.particles, this.rc);

        if (allArrived) {
            this.stop();
            this.onComplete?.();
            return;
        }

        this.animationId = requestAnimationFrame(this.draw);
    }
}


export function moveParticlesTowardsTarget({ particles, speed } ) {
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


export function moveParticlesInCircle({ particles, speed, rc }) {
    const centerX = rc.canvas.clientWidth / 2;
    const centerY = rc.canvas.clientHeight / 2;

    for (const p of particles) {
        const dx = p.x - centerX;
        const dy = p.y - centerY;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance === 0) {
            p.x += speed;
            continue;
        }

        const angle = Math.atan2(dy, dx);
        const radius = distance;

        const angularSpeed = speed / radius;
        const newAngle = angle + angularSpeed;

        p.x = centerX + Math.cos(newAngle) * radius;
        p.y = centerY + Math.sin(newAngle) * radius;
    }

    return false;
}



export function explodeParticles({ particles, speed, rc }) {
    const centerX = rc.canvas.clientWidth / 2;
    const centerY = rc.canvas.clientHeight / 2;

    let allStopped = true;
    const stopThreshold = 0.05;

    for (const p of particles) {
        if (p.explodeVX === undefined || p.explodeVY === undefined) {
            const dx = p.x - centerX;
            const dy = p.y - centerY;

            const distance = Math.sqrt(dx * dx + dy * dy) || 1;

            p.explodeVX = (dx / distance) * speed * (0.5 + Math.random());
            p.explodeVY = (dy / distance) * speed * (0.5 + Math.random());
        }

        p.x += p.explodeVX;
        p.y += p.explodeVY;

        p.explodeVX *= 0.98;
        p.explodeVY *= 0.98;

        const velocity = Math.sqrt(
            p.explodeVX * p.explodeVX +
            p.explodeVY * p.explodeVY
        );

        if (velocity > stopThreshold) {
            allStopped = false;
        } else {
            p.explodeVX = 0;
            p.explodeVY = 0;
        }
    }

    return allStopped;
}








