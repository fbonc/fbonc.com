import { showElement, hideElement, clearCanvas } from "./utils.js";
import { html2canvas } from 'html2canvas-pro';

export async function drawElement(el, rc) {
    const captured = await captureElement(el);

    clearCanvas(rc);
    drawCapturedElement(rc.ctx, captured);
}


async function captureElement(el) {
    if (!el) {
        throw new Error("Cannot capture missing element.");
    }

    const dpr = window.devicePixelRatio || 1;

    const bitmap = await html2canvas(el, {
        backgroundColor: null,
        scale: dpr,
        onclone: (documentClone) => {
            const clone = documentClone.getElementById(el.id);

            if (!clone) return;

            clone.style.visibility = "visible";
            clone.style.opacity = "1";
            clone.style.pointerEvents = "";
        },
    });

    const rect = el.getBoundingClientRect();


    return {
        bitmap,
        rect,
    };
}

function drawCapturedElement(ctx, captured) {
    const { bitmap, rect } = captured;

    ctx.drawImage(
        bitmap,
        rect.left,
        rect.top,
        rect.width,
        rect.height
    );
}

export function samplePixels(rc) {
    const dpr = window.devicePixelRatio || 1;

    const { canvas, ctx } = rc;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const data = imageData.data;
    const pixels = [];

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];

        if (alpha > 0) {
            const pixelIndex = i / 4;

            const x = (pixelIndex % canvas.width) / dpr;
            const y = Math.floor(pixelIndex / canvas.width) / dpr;

            pixels.push({x, y, r: data[i], g: data[i + 1], b: data[i + 2], a: alpha,});
        }
    }

    return pixels;
}
