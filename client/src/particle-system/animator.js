import { clearCanvas } from "./utils.js";
import { renderParticles } from "./particleSystem.js";
import { activeAnimator } from "./main.js";


export class ParticleAnimator {
    constructor({
        rc,
        particles,
        animation,
        onComplete = null,
        speed = 5,
        animationArgs = {}
    }) {
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


export async function startAnimator(animator) {
    await activeAnimator?.stop();
    activeAnimator = animator;
    animator.start();
}


function isOffscreen(p, rc, margin = 0) {
    const w = rc.canvas.clientWidth;
    const h = rc.canvas.clientHeight;
    return p.x < -margin || p.x > w + margin || p.y < -margin || p.y > h + margin;
}


function lerp(a, b, t) {
    return a + (b - a) * t;
}


export function moveParticlesTowardsTarget({
    particles,
    speed,
    rc = null,
    minSpeed = 0.01,
    accelerationDistance = 120,
    arrivalThreshold = 0.5,
    speedSmoothing = 0.005,
    colorLerpRate = 0,
    radiusLerpRate = 0,
    cullOffscreen = false,
    cullMargin = 0
}) {
    let allArrived = true;

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

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

        if (colorLerpRate > 0) {
            p.color.r = lerp(p.color.r, p.targetColor.r, colorLerpRate);
            p.color.g = lerp(p.color.g, p.targetColor.g, colorLerpRate);
            p.color.b = lerp(p.color.b, p.targetColor.b, colorLerpRate);
        }

        if (radiusLerpRate > 0) {
            p.radius = lerp(p.radius, p.targetRadius, radiusLerpRate);
        }

        if (cullOffscreen && p.dying && rc && isOffscreen(p, rc, cullMargin)) {
            particles.splice(i, 1);
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


export function moveParticlesInOrbit({
    particles, speed, rc,
    breathAmount = 0.25,
    breathSpeed = 0.0008,
    ripple = 0.025,
    wobbleAmount = 0.4,
    wobbleHarmonic = 3,
    twist = 0.3
}) {
    const centerX = rc.canvas.clientWidth / 2;
    const centerY = rc.canvas.clientHeight / 2;
    const t = performance.now() * breathSpeed;

    for (const p of particles) {
        if (p.baseRadius === undefined) {
            const dx = p.x - centerX;
            const dy = p.y - centerY;
            const d = Math.sqrt(dx * dx + dy * dy);
            p.baseRadius = d || 1;
            p.baseAngle = Math.atan2(dy, dx);
            p.angle = p.baseAngle;
        }

        p.angle += speed / p.baseRadius;

        const radiusPhase = t - p.baseRadius * ripple;
        const breath = Math.sin(radiusPhase) * breathAmount;
        const r = p.baseRadius * (1 + breath);

        const wobble = Math.sin(wobbleHarmonic * p.angle + t * 2) * wobbleAmount / wobbleHarmonic;
        const twistOffset = breath * twist;
        const displayAngle = p.angle + wobble + twistOffset;

        p.x = centerX + Math.cos(displayAngle) * r;
        p.y = centerY + Math.sin(displayAngle) * r;
    }

    return false;
}

export function explodeParticles({
    particles,
    speed,
    rc,
    stopThreshold = 0.05,
    deceleration = 0.98
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

        p.explodeVX *= deceleration;
        p.explodeVY *= deceleration;

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


