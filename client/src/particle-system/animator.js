import { clearCanvas } from "./canvas.js";
import { renderParticles } from "./particleSystem.js";


export class ParticleAnimator {
    constructor({ rc, particles, animation, onComplete = null, speed = 5, animationArgs = {}, smoothStop = false, stopDuration = 300 }) {
        this.rc = rc;
        this.particles = particles;
        this.animation = animation;
        this.onComplete = onComplete;
        this.speed = speed;
        this.animationArgs = animationArgs;
        this.smoothStop = smoothStop;
        this.stopDuration = stopDuration;

        this.animationId = null;
        this.isStopping = false;
        this.stopStartTime = null;

        this.draw = this.draw.bind(this);
    }

    start() {
        this.stop();
        this.isStopping = false;
        this.stopStartTime = null;
        this.draw();
    }

    stop({ immediate = false } = {}) {
        if (this.animationId === null) return Promise.resolve();

        if (!this.smoothStop || immediate) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
            return Promise.resolve();
        }

        if (!this.isStopping) {
            this.isStopping = true;
            this.stopStartTime = performance.now();
            this._stopPromise = new Promise(resolve => { this._stopResolve = resolve; });
        }
        return this._stopPromise;
    }

    draw() {
        clearCanvas(this.rc);

        let effectiveSpeed = this.speed;
        if (this.isStopping) {
            const t = Math.min((performance.now() - this.stopStartTime) / this.stopDuration, 1);
            effectiveSpeed = this.speed * (1 - t);

            if (t >= 1) {
                this.isStopping = false;
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
                this._stopResolve?.();
                this._stopResolve = null;
                this.onComplete?.();
                return;
            }
        }

        const allArrived = this.animation({
            particles: this.particles,
            speed: effectiveSpeed,
            rc: this.rc,
            ...this.animationArgs
        });

        renderParticles(this.particles, this.rc);

        if (allArrived) {
            if (!this.smoothStop) {
                this.stop({ immediate: true });
                this.onComplete?.();
                return;
            }
            if (!this.isStopping) {
                this.isStopping = true;
                this.stopStartTime = performance.now();
            }
        }

        this.animationId = requestAnimationFrame(this.draw);
    }
}


export function moveParticlesTowardsTarget({
    particles,
    speed,
    minSpeed = 0.01,
    accelerationDistance = 120,
    arrivalThreshold = 0.5,
    speedSmoothing = 0.005
}) {
    let allArrived = true;

    for (const p of particles) {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > arrivalThreshold) {
            const t = Math.min(distance / accelerationDistance, 1);
            const desiredSpeed = minSpeed + (speed - minSpeed) * t;

            if (p.currentSpeed === undefined) p.currentSpeed = minSpeed;
            p.currentSpeed += (desiredSpeed - p.currentSpeed) * speedSmoothing;

            const moveDistance = Math.min(p.currentSpeed, distance);

            p.x += (dx / distance) * moveDistance;
            p.y += (dy / distance) * moveDistance;

            allArrived = false;
        } else {
            p.x = p.targetX;
            p.y = p.targetY;
            p.currentSpeed = minSpeed;
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


export function explodeParticles({
    particles,
    speed,
    rc,
    stopThreshold = 0.05
}) {
    const centerX = rc.canvas.clientWidth / 2;
    const centerY = rc.canvas.clientHeight / 2;

    let allStopped = true;

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