import { FADE_DURATION_MS } from "./main.js";

export function downloadCanvas(canvas, filename = "download.png") {
    const dataUrl = canvas.toDataURL('image/png');

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


export function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}


export function hideElement(el) {
    el.style.transition = "none";
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
}


export function showElement(el) {
    el.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    el.style.visibility = "visible";
    el.style.pointerEvents = "";

    requestAnimationFrame(() => {
        el.style.opacity = "1";
    });
}


export function hideCanvas(c) {
    c.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    c.style.visibility = "visible";

    requestAnimationFrame(() => {
        c.style.opacity = "0";
    });

    setTimeout(() => {
        c.style.visibility = "hidden";
    }, FADE_DURATION_MS);
}


export function showCanvas(c) {
    c.style.transition = "none";
    c.style.visibility = "visible";
    c.style.opacity = "1";
}











// ------------------------------------------------------
// import { createRenderingContext, resizeCanvas, clearCanvas } from "./canvas.js";
// import { ParticleAnimator, createTextParticles } from "./particleSystem.js";
// import { renderParticles } from "./particle.js";
// import { drawCapturedElement } from "./sample.js";
// import { captureElement, samplePixels } from "./sample.js";
// import { hideElement, showElement, hideCanvas, showCanvas } from "./utils.js";


// export const fadeToken = 0;

// function fadeToHtml() {
//     const token = ++fadeToken;

//         sourceElement.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
//         sourceElement.style.visibility = "visible";
//         sourceElement.style.pointerEvents = "";

//         particleCanvas.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
//         particleCanvas.style.visibility = "visible";

//         requestAnimationFrame(() => {
//             if (token !== fadeToken) return;

//             sourceElement.style.opacity = "1";
//             particleCanvas.style.opacity = "0";
//         });

//         setTimeout(() => {
//             if (token !== fadeToken) return;
//             particleCanvas.style.visibility = "hidden";
//         }, FADE_DURATION_MS);
// }


// async function initializeParticles() {
//     resizeCanvas(groundTruthRC);
//     resizeCanvas(particleCanvasRC);

//     clearCanvas(groundTruthRC);
//     clearCanvas(particleCanvasRC);

//     const captured = await captureElement(sourceElement);
//     clearCanvas(groundTruthRC);
//     drawCapturedElement(groundTruthRC.ctx, captured);
//     const textParticles = createTextParticles({
//         sourceRC: groundTruthRC,
//         targetRC: particleCanvasRC,
//         samplePixels,
//     });

//     clearCanvas(particleCanvasRC);
//     renderParticles(textParticles, particleCanvasRC);

//     hideElement(sourceElement);

//     return textParticles;
// }

// const groundTruthRC = createRenderingContext("groundTruthCanvas", { willReadFrequently: true, });

// const particleCanvasRC = createRenderingContext("particleCanvas", { willReadFrequently: true, });

// const animator = new ParticleAnimator(particleCanvasRC);

// const particleCanvas = particleCanvasRC.canvas;
// export const FADE_DURATION_MS = 1000;

// const sourceElement = document.getElementById("biotext");
// if (!sourceElement) {
//     throw new Error("Cannot find #biotext source element.");
// }

// const textParticles = await initializeParticles();

// window.addEventListener("click", () => {
//     animator.start(textParticles, {
//         onComplete: () => {
//             fadeToHtml?.({sourceElement, particleCanvas});
//         },
//     });
// });
