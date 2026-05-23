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