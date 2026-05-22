import { drawBitmap } from "./text.js";

const canvas = document.getElementById('particleCanvas');
var ctx = canvas.getContext('2d');

function resize() {
    const dpr = window.devicePixelRatio || 1;

    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawElement(ctx, document.getElementById('biotext'));
}

resize();
window.addEventListener('resize', resize);
