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
1

export function showCanvas(c) {
    c.style.transition = "none";
    c.style.visibility = "visible";
    c.style.opacity = "1";
}


export function fadeOut(element, duration = 300) {
    element.style.animation = "none";
    element.style.transition = "none";

    const currentOpacity = getComputedStyle(element).opacity;
    element.style.opacity = currentOpacity;

    element.offsetHeight;

    element.style.transition = `opacity ${duration}ms ease`;
    element.style.opacity = "0";

    return new Promise(resolve => {
        setTimeout(() => {
            element.style.display = "none";
            element.style.transition = "";
            resolve();
        }, duration);
    });
}


export function fadeIn(element, duration = 300, display = "block", targetOpacity = null) {
    element.style.display = display;
    element.style.animation = "none";
    element.style.transition = "none";
    element.style.opacity = "0";

    const finalOpacity =
        targetOpacity ?? element.dataset.originalOpacity ?? "1";

    element.offsetHeight;

    element.style.transition = `opacity ${duration}ms ease`;
    element.style.opacity = finalOpacity;

    return new Promise(resolve => {
        setTimeout(() => {
            element.style.transition = "";
            resolve();
        }, duration);
    });
}


export function pulseOpacity(element, {
    minOpacity = 0.3,
    maxOpacity = 1,
    duration = 1000
} = {}) {
    element.style.opacity = maxOpacity;
    element.style.animation = `pulse-opacity ${duration}ms ease-in-out infinite`;

    if (!document.getElementById("pulse-opacity-style")) {
        const style = document.createElement("style");
        style.id = "pulse-opacity-style";
        style.textContent = `
            @keyframes pulse-opacity {
                0% {
                    opacity: ${maxOpacity};
                }
                50% {
                    opacity: ${minOpacity};
                }
                100% {
                    opacity: ${maxOpacity};
                }
            }
        `;
        document.head.appendChild(style);
    }
}