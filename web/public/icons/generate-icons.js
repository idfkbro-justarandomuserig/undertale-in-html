// One-off script: generates icon-192.png / icon-512.png without any image
// library dependency (hand-rolled minimal PNG encoder using node:zlib deflate).
// Run with: node web/public/icons/generate-icons.js
import zlib from 'node:zlib';
import fs from 'node:fs';

function crc32(buf) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function brandedPng(size, bg, fg) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor RGB
  const ihdr = chunk('IHDR', ihdrData);

  const inset = Math.round(size * 0.28);
  const rowLen = size * 3 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0; // filter: none
    const inBand = y >= inset && y < size - inset;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3;
      const useFg = inBand && x >= inset && x < size - inset;
      const [r, g, b] = useFg ? fg : bg;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

const bg = [15, 23, 42]; // #0f172a
const fg = [79, 140, 255]; // #4f8cff

const dir = new URL('.', import.meta.url);
fs.writeFileSync(new URL('icon-192.png', dir), brandedPng(192, bg, fg));
fs.writeFileSync(new URL('icon-512.png', dir), brandedPng(512, bg, fg));
console.log('Wrote icon-192.png and icon-512.png');
