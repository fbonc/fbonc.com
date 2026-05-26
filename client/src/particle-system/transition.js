import { Particle } from "./particleSystem.js";
import { showElement, hideCanvas } from "./utils.js";


function shuffleInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}


export function assignTransitionTargets({
    particles,
    targets,
    spawnBirth,
    chooseDeathPos,
    bornRadius = 1
}) {
    const particleOrder = shuffleInPlace([...Array(particles.length).keys()]);
    const targetOrder = shuffleInPlace([...Array(targets.length).keys()]);

    const matchedCount = Math.min(particles.length, targets.length);

    for (let i = 0; i < matchedCount; i++) {
        const p = particles[particleOrder[i]];
        const t = targets[targetOrder[i]];

        p.targetX = t.targetX;
        p.targetY = t.targetY;
        p.targetColor = { ...t.targetColor };
        p.targetRadius = t.targetRadius;
        p.dying = false;
        p.currentSpeed = undefined;
    }

    for (let i = matchedCount; i < particles.length; i++) {
        const p = particles[particleOrder[i]];
        const deathPos = chooseDeathPos(p.x, p.y);

        p.targetX = deathPos.x;
        p.targetY = deathPos.y;
        p.targetColor = { ...p.color };
        p.targetRadius = p.radius;
        p.dying = true;
        p.currentSpeed = undefined;
    }

    for (let i = matchedCount; i < targets.length; i++) {
        const t = targets[targetOrder[i]];
        const birthPos = spawnBirth(t.targetX, t.targetY);

        particles.push(
            new Particle(
                birthPos.x, birthPos.y,
                t.targetX, t.targetY,
                bornRadius, t.targetRadius,
                { ...t.targetColor }, { ...t.targetColor }
            )
        );
    }
}

export function fadeToHtml(el, c) {
    showElement(el);
    hideCanvas(c);
}

