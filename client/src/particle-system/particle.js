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

export function renderParticles(particles, rc) {
    for (const p of particles) {
        rc.ctx.beginPath();
        rc.ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
        rc.ctx.fillStyle = p.color;
        rc.ctx.fill();
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
