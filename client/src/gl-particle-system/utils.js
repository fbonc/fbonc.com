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


function clearPendingFade(el) {
    if (el._pendingFadeTimeout) {
        clearTimeout(el._pendingFadeTimeout);
        el._pendingFadeTimeout = null;
    }
}


export function clearCanvas(rc) {
    const dpr = window.devicePixelRatio || 1;
    rc.ctx.clearRect(0, 0, rc.canvas.width / dpr, rc.canvas.height / dpr);
}




export function showElement(el) {
    clearPendingFade(el);
    el.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    el.style.display = "";
    el.style.visibility = "visible";
    el.style.pointerEvents = "";

    requestAnimationFrame(() => {
        el.style.opacity = "1";
    });
}


export function hideCanvas(c) {
    clearPendingFade(c);
    c.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    c.style.visibility = "visible";

    requestAnimationFrame(() => {
        c.style.opacity = "0";
    });

    c._pendingFadeTimeout = setTimeout(() => {
        c._pendingFadeTimeout = null;
        c.style.visibility = "hidden";
    }, FADE_DURATION_MS);
}


export function showCanvas(c) {
    clearPendingFade(c);
    c.style.transition = "none";
    c.style.visibility = "visible";
    c.style.opacity = "1";
}


export function fadeInCanvas(c, duration = FADE_DURATION_MS) {
    clearPendingFade(c);
    const currentOpacity = getComputedStyle(c).opacity;

    c.style.transition = "none";
    c.style.visibility = "visible";
    c.style.opacity = currentOpacity;

    c.offsetHeight;

    c.style.transition = `opacity ${duration}ms ease`;
    c.style.opacity = "1";

    return new Promise(resolve => {
        c._pendingFadeTimeout = setTimeout(() => {
            c._pendingFadeTimeout = null;
            c.style.transition = "";
            resolve();
        }, duration);
    });
}


export function fadeOut(element, duration = 300) {
    clearPendingFade(element);
    const currentOpacity = getComputedStyle(element).opacity;

    element.style.animation = "none";
    element.style.transition = "none";
    element.style.opacity = currentOpacity;

    element.offsetHeight;

    element.style.transition = `opacity ${duration}ms ease`;
    element.style.opacity = "0";

    return new Promise(resolve => {
        element._pendingFadeTimeout = setTimeout(() => {
            element._pendingFadeTimeout = null;
            element.style.display = "none";
            element.style.transition = "";
            resolve();
        }, duration);
    });
}


export function fadeIn(element, duration = 300, display = "block", targetOpacity = null) {
    clearPendingFade(element);
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
        element._pendingFadeTimeout = setTimeout(() => {
            element._pendingFadeTimeout = null;
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