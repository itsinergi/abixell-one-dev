import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function roundedRectAlpha(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x >= right || y < top || y >= bottom) return false;
  const cx = x < left + radius ? left + radius : x >= right - radius ? right - radius - 1 : x;
  const cy = y < top + radius ? top + radius : y >= bottom - radius ? bottom - radius - 1 : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 512;
  const slate = [15, 23, 42, 255];
  const white = [255, 255, 255, 255];

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const px = rowOffset + 1 + x * 4;
      const color = roundedRectAlpha(x, y, 0, 0, size, size, 96 * scale) ? slate : [0, 0, 0, 0];
      raw[px] = color[0];
      raw[px + 1] = color[1];
      raw[px + 2] = color[2];
      raw[px + 3] = color[3];
    }
  }

  const bars = [
    { x: 140, y: 150, w: 232, h: 28, r: 14 },
    { x: 140, y: 242, w: 232, h: 28, r: 14 },
    { x: 140, y: 334, w: 150, h: 28, r: 14 },
  ];
  for (const bar of bars) {
    for (let y = Math.floor(bar.y * scale); y < Math.ceil((bar.y + bar.h) * scale); y += 1) {
      for (let x = Math.floor(bar.x * scale); x < Math.ceil((bar.x + bar.w) * scale); x += 1) {
        if (!roundedRectAlpha(x, y, bar.x * scale, bar.y * scale, bar.w * scale, bar.h * scale, bar.r * scale)) continue;
        const px = y * (size * 4 + 1) + 1 + x * 4;
        raw[px] = white[0];
        raw[px + 1] = white[1];
        raw[px + 2] = white[2];
        raw[px + 3] = white[3];
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  await writeFile(new URL(`../apps/web/public/icon-${size}.png`, import.meta.url), makeIcon(size));
}

console.log("Generated neutral PWA PNG icons.");
