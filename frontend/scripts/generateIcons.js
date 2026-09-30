import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPngBuffer(width, height, pixelFn) {
  // 8-byte PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: width(4), height(4), bitDepth(1)=8, colorType(1)=6(RGBA), comp(1)=0, filter(1)=0, interlace(1)=0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8 bits per channel
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0 (None)
  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    rawScanlines[offset] = 0; // Filter byte: None
    offset += 1;

    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawScanlines[offset] = r;
      rawScanlines[offset + 1] = g;
      rawScanlines[offset + 2] = b;
      rawScanlines[offset + 3] = a;
      offset += 4;
    }
  }

  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = data.length;
  const buffer = Buffer.alloc(8 + length + 4);
  buffer.writeUInt32BE(length, 0);
  buffer.write(type, 4, 4, 'ascii');
  data.copy(buffer, 8);

  const typeAndData = buffer.subarray(4, 8 + length);
  const crc = zlib.crc32(typeAndData);
  buffer.writeUInt32BE(crc >>> 0, 8 + length);
  return buffer;
}

// Signed Distance Field helpers for smooth sub-pixel anti-aliasing
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Distance to rounded box
function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Distance to capsule / segment
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.hypot(dx, dy);
}

// Cooking pot distance function
function sdCookingPot(nx, ny) {
  // Pot body (bowl): rounded rect at bottom, open top
  // nx, ny in normalized space [-1, 1]
  const bodyBox = sdRoundedBox(nx, ny - 0.12, 0.28, 0.16, 0.12);
  const bodyTopCut = -(ny - 0.00); // cut above y = 0
  const body = Math.max(bodyBox, bodyTopCut);

  // Pot Rim: rounded bar
  const rim = sdRoundedBox(nx, ny - 0.00, 0.32, 0.024, 0.016);

  // Handles: left and right curved segments
  const leftHandle = sdSegment(nx, ny, -0.30, 0.05, -0.42, 0.05) - 0.028;
  const rightHandle = sdSegment(nx, ny, 0.30, 0.05, 0.42, 0.05) - 0.028;

  // Lid: rounded arch
  const lidBox = sdRoundedBox(nx, ny + 0.05, 0.27, 0.04, 0.03);
  const lid = Math.max(lidBox, ny + 0.01); // cut lower half

  // Lid knob
  const knob = sdRoundedBox(nx, ny + 0.10, 0.055, 0.02, 0.015);

  // Steam lines (3 gentle wavy streams)
  // center steam
  const steamC1 = sdSegment(nx, ny, 0.0, -0.15, 0.03, -0.23) - 0.015;
  const steamC2 = sdSegment(nx, ny, 0.03, -0.23, -0.01, -0.32) - 0.015;
  const steamC = Math.min(steamC1, steamC2);

  // left steam
  const steamL1 = sdSegment(nx, ny, -0.14, -0.15, -0.11, -0.22) - 0.013;
  const steamL2 = sdSegment(nx, ny, -0.11, -0.22, -0.15, -0.30) - 0.013;
  const steamL = Math.min(steamL1, steamL2);

  // right steam
  const steamR1 = sdSegment(nx, ny, 0.14, -0.15, 0.17, -0.22) - 0.013;
  const steamR2 = sdSegment(nx, ny, 0.17, -0.22, 0.13, -0.30) - 0.013;
  const steamR = Math.min(steamR1, steamR2);

  const steam = Math.min(steamC, steamL, steamR);

  return Math.min(body, rim, leftHandle, rightHandle, lid, knob, steam);
}

function renderIcon({ isMaskable = false }) {
  return function pixelShader(x, y, width, height) {
    // Normalized coords [-1, 1]
    const nx = (x / (width - 1)) * 2 - 1;
    const ny = (y / (height - 1)) * 2 - 1;
    const pixelSize = 2 / Math.min(width, height);

    // Background:
    // If maskable: full canvas background (no transparent corner).
    // If regular: rounded squircle (r = 0.22) with subtle margin.
    let bgAlpha = 1.0;
    if (!isMaskable) {
      const bgDist = sdRoundedBox(nx, ny, 0.88, 0.88, 0.32);
      bgAlpha = smoothstep(pixelSize * 0.5, -pixelSize * 0.5, bgDist);
    }

    if (bgAlpha <= 0) {
      return [0, 0, 0, 0];
    }

    // Rich gradient: deep ocean #32658d to midnight navy #193853
    const gradT = clamp((ny + 1) * 0.5, 0, 1);
    const bgR = Math.round(mix(50, 25, gradT));
    const bgG = Math.round(mix(101, 56, gradT));
    const bgB = Math.round(mix(141, 83, gradT));

    // Foreground symbol: scale slightly smaller for maskable to stay safely inside 65% circle
    const scale = isMaskable ? 1.35 : 1.15;
    const potDist = sdCookingPot(nx * scale, ny * scale);
    const potAlpha = smoothstep(pixelSize * scale * 0.75, -pixelSize * scale * 0.75, potDist);

    // Subtle inner shadow / border on pot for crisp contrast
    const potR = 255;
    const potG = 255;
    const potB = 255;

    // Blend symbol over background
    const finalR = Math.round(mix(bgR, potR, potAlpha));
    const finalG = Math.round(mix(bgG, potG, potAlpha));
    const finalB = Math.round(mix(bgB, potB, potAlpha));
    const finalA = Math.round(bgAlpha * 255);

    return [finalR, finalG, finalB, finalA];
  };
}

const iconsDir = path.resolve('frontend/public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

console.log('Generating PWA icons...');

// 512x512 standard
const icon512 = createPngBuffer(512, 512, renderIcon({ isMaskable: false }));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), icon512);

// 512x512 maskable (full bleed background, pot within safe area)
const iconMaskable512 = createPngBuffer(512, 512, renderIcon({ isMaskable: true }));
fs.writeFileSync(path.join(iconsDir, 'icon-maskable-512.png'), iconMaskable512);

// 192x192 standard
const icon192 = createPngBuffer(192, 192, renderIcon({ isMaskable: false }));
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), icon192);

// 180x180 Apple touch icon (full bleed background)
const appleTouchIcon = createPngBuffer(180, 180, renderIcon({ isMaskable: true }));
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), appleTouchIcon);

// 32x32 Favicon PNG
const favicon32 = createPngBuffer(32, 32, renderIcon({ isMaskable: false }));
fs.writeFileSync(path.join(iconsDir, 'favicon-32.png'), favicon32);

// Vector SVG favicon for high resolution desktop browser tabs
const svgFavicon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#32658d"/>
      <stop offset="100%" stop-color="#193853"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>
  <g fill="#ffffff" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">
    <!-- Lid knob -->
    <rect x="236" y="162" width="40" height="16" rx="8" />
    <!-- Lid -->
    <path d="M160 214 C160 188 352 188 352 214 Z" />
    <!-- Rim -->
    <rect x="144" y="214" width="224" height="18" rx="9" />
    <!-- Handles -->
    <path d="M144 240 C110 240 110 270 144 270" fill="none" stroke-width="16" />
    <path d="M368 240 C402 240 402 270 368 270" fill="none" stroke-width="16" />
    <!-- Body -->
    <path d="M160 232 L352 232 C352 334 320 364 256 364 C192 364 160 334 160 232 Z" />
    <!-- Steam waves -->
    <path d="M256 148 Q264 130 256 112" fill="none" stroke-width="10" />
    <path d="M220 148 Q228 130 220 112" fill="none" stroke-width="9" />
    <path d="M292 148 Q300 130 292 112" fill="none" stroke-width="9" />
  </g>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'favicon.svg'), svgFavicon);

console.log('Successfully generated all icons in frontend/public/icons/');
