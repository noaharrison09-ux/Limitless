// Renders the app icons (brushed dark-silver tile + polished silver infinity mark) to web/public/icons.
// Usage: node scripts/make-icons.mjs   (needs Playwright + Chromium available)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node-tools/node_modules/playwright");
}

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/public/icons");

function svg({ size, pad = 0, badge = false }) {
  const inner = size - pad * 2;
  const s = inner / 512;
  if (badge) {
    // Monochrome silhouette for Android's status-bar badge.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
      <path d="M256 256 C 214 190, 120 190, 120 256 C 120 322, 214 322, 256 256 C 298 190, 392 190, 392 256 C 392 322, 298 322, 256 256 Z"
        fill="none" stroke="#fff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#62686f"/><stop offset="0.5" stop-color="#3b4046"/><stop offset="1" stop-color="#22262b"/>
    </linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${0.0025 / (size / 512)} ${0.9 / (size / 512)}" numOctaves="2" seed="4"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.5 0 0 0 -0.2"/>
    </filter>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0.15" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.38" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#dfe3e8"/><stop offset="0.55" stop-color="#b7bec7"/><stop offset="1" stop-color="#e9ecf0"/>
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${6 * s}" stdDeviation="${8 * s}" flood-color="#06080a" flood-opacity="0.55"/></filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#base)"/>
  <rect width="${size}" height="${size}" filter="url(#grain)"/>
  <rect width="${size}" height="${size}" fill="url(#sheen)"/>
  <g transform="translate(${pad} ${pad}) scale(${s})" filter="url(#shadow)">
    <path d="M256 256 C 210 176, 116 180, 116 256 C 116 332, 210 336, 256 256 C 302 176, 396 180, 396 256 C 396 332, 302 336, 256 256 Z"
      fill="none" stroke="url(#mark)" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "maskable-512.png", size: 512, pad: 64 },
  { file: "badge-96.png", size: 96, badge: true },
];

const browser = await playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t)}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(out, t.file), omitBackground: !!t.badge });
  console.log("wrote", t.file);
}
await browser.close();
