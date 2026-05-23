export class RenderingContext {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }
}


export function createRenderingContext(canvasId, options = {}) {
    const canvas = document.getElementById(canvasId);

    if (!canvas) {
        throw new Error(`Canvas with id "${canvasId}" not found.`);
    }

    const ctx = canvas.getContext("2d", options);

    if (!ctx) {
        throw new Error(`Could not create 2D context for "${canvasId}".`);
    }

    return new RenderingContext(canvas, ctx);
}


export function resizeCanvas(rc) {
    const dpr = window.devicePixelRatio || 1;

    rc.canvas.width = window.innerWidth * dpr;
    rc.canvas.height = window.innerHeight * dpr;

    rc.canvas.style.width = `${window.innerWidth}px`;
    rc.canvas.style.height = `${window.innerHeight}px`;

    rc.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}


export function clearCanvas(rc) {
    rc.ctx.clearRect(0, 0, rc.canvas.clientWidth, rc.canvas.clientHeight);
}