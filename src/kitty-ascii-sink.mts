/**
 * @file src/kitty-ascii-sink.mts
 * @description Zero-dependency Skia RGBA framebuffer renderer for TTY terminals:
 *   1. True-color Unicode Half-Block ASCII (`▀` / `\x1b[38;2;...;48;2;...m`) for any SSH / ttyS0 / ANSI terminal.
 *   2. Kitty Graphics Protocol (`\x1b_Ga=T,f=32,s=<w>,v=<h>,m=<more>;<base64>\x1b\\`) for pixel-perfect
 *      Chromium / Sectium rendering inside Kitty, WezTerm, Ghostty, and Konsole with zero X11/Wayland/GPU.
 */

export interface SkiaRgbaFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Renders a Skia RGBA8888 framebuffer into 24-bit ANSI true-color Unicode half-blocks (`▀`).
 * Packs 2 vertical pixels per terminal row for crisp aspect-ratio rendering over SSH / ttyS0.
 */
export function renderSkiaFrameToAnsiHalfBlocks(frame: SkiaRgbaFrame): string {
  const { width, height, rgba } = frame;
  if (rgba.byteLength < width * height * 4) {
    throw new RangeError(`RGBA buffer too small: expected >= ${width * height * 4} bytes, got ${rgba.byteLength}`);
  }
  const lines: string[] = [];
  for (let y = 0; y < height; y += 2) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const topIdx = (y * width + x) * 4;
      const tr = rgba[topIdx];
      const tg = rgba[topIdx + 1];
      const tb = rgba[topIdx + 2];

      const botY = y + 1 < height ? y + 1 : y;
      const botIdx = (botY * width + x) * 4;
      const br = rgba[botIdx];
      const bg = rgba[botIdx + 1];
      const bb = rgba[botIdx + 2];

      row += `\x1b[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m\u2580`;
    }
    row += '\x1b[0m';
    lines.push(row);
  }
  return lines.join('\n');
}

/**
 * Encodes a Skia RGBA8888 framebuffer as chunked Kitty Graphics Protocol APC escape sequences.
 */
export function renderSkiaFrameToKittyProtocol(frame: SkiaRgbaFrame, chunkSize = 4096): string {
  const { width, height, rgba } = frame;
  if (rgba.byteLength < width * height * 4) {
    throw new RangeError(`RGBA buffer too small: expected >= ${width * height * 4} bytes, got ${rgba.byteLength}`);
  }
  const b64 = Buffer.from(rgba.buffer, rgba.byteOffset, width * height * 4).toString('base64');
  const packets: string[] = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    const slice = b64.slice(i, i + chunkSize);
    const more = i + chunkSize < b64.length ? 1 : 0;
    if (i === 0) {
      packets.push(`\x1b_Ga=T,f=32,s=${width},v=${height},m=${more};${slice}\x1b\\`);
    } else {
      packets.push(`\x1b_Gm=${more};${slice}\x1b\\`);
    }
  }
  return packets.join('');
}
