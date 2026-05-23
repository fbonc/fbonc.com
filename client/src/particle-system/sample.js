import { downloadCanvas } from "./utils.js";

async function captureBitmap(el) {
    return await html2canvas(el, {
        backgroundColor: null,
        scale: window.devicePixelRatio,
    });
    // const ctx = bitmap.getContext("2d");
    // const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function captureElement(el) {
    const bitmap = await html2canvas(el, {
        backgroundColor: null,
        scale: window.devicePixelRatio || 1,
    });

    const rect = el.getBoundingClientRect();

    return { bitmap, rect };
}


export function drawCapturedElement(ctx, captured) {
    const { bitmap, rect } = captured;

    ctx.drawImage(bitmap, rect.left, rect.top, rect.width, rect.height);
}

export function samplePixels(rc) {
    const canvas = rc.canvas;
    const ctx = rc.ctx;
    const dpr = window.devicePixelRatio || 1;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const nonTransparentPixels = [];

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];

        if (alpha > 0) {
            const pixelIndex = i / 4;

            const x = (pixelIndex % canvas.width) / dpr;
            const y = Math.floor(pixelIndex / canvas.width) / dpr;

            nonTransparentPixels.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2], a: alpha });
        }
    }

    return nonTransparentPixels;
}



// ---- SHIDDY DIRECT DOM FILTERING FOR TEXT METHOD ----

// function hasOwnText(el) {
//   return [...el.childNodes].some(node =>
//     node.nodeType === Node.TEXT_NODE &&
//     node.textContent.trim().length > 0
//   );
// }

// function isVisible(el) {
//   const style = getComputedStyle(el);

//   return (
//     style.display !== "none" &&
//     style.visibility !== "hidden" &&
//     style.opacity !== "0" &&
//     el.getClientRects().length > 0
//   );
// }

// export function getTextElements(root = document.body) {
//   const ignored = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS"]);

//   return [...root.querySelectorAll("*")].filter(el => {
//     if (ignored.has(el.tagName)) return false;
//     if (!isVisible(el)) return false;
//     if (!el.innerText.trim()) return false;

//     if (!hasOwnText(el)) return false;

//     const parent = el.parentElement;
//     if (
//       parent &&
//       ["A", "SPAN", "STRONG", "EM", "B", "I"].includes(el.tagName) &&
//       hasOwnText(parent)
//     ) return false;

//     return true;
//   });
// }


// export function drawText(elements, ctx) {
//     elements.forEach(element => {
//         const style = window.getComputedStyle(element);
//         const rect = element.getBoundingClientRect();

//         ctx.save();

//         ctx.font = style.font;
//         ctx.fillStyle = style.color;
//         ctx.textBaseline = "top";

//         const text = element.innerText;
//         const words = text.split(/\s+/);
//         const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
//         const maxWidth = rect.width;

//         let line = "";
//         let y = rect.top;

//         for (const word of words) {
//             const testLine = line ? line + " " + word : word;
//             const width = ctx.measureText(testLine).width;

//             if (width > maxWidth && line) {
//                 ctx.fillText(line, rect.left, y);
//                 line = word;
//                 y += lineHeight;
//             } else {
//                 line = testLine;
//             }
//         }

//         if (line) {
//             ctx.fillText(line, rect.left, y);
//         }

//         ctx.restore();
//     });
// }