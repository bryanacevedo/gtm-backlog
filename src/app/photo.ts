/* Turns a chosen image file into the 160px square JPEG the server accepts (under 40 KB). Client-side only; the server checks it again. */

import { PHOTO_MAX_BYTES, PHOTO_SIZE } from "../shared/settings";

/** Centre-crops to a square, scales to 160px, and lowers the JPEG quality until it fits. Throws a message a person can read. */
export async function squareJpeg(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("That image could not be read. Try a JPEG or PNG."); }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize photos.");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bmp.close();
  for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (Math.floor((url.length - url.indexOf(",") - 1) * 3 / 4) < PHOTO_MAX_BYTES) return url;
  }
  throw new Error("That photo is too detailed to fit in 40 KB. Try a simpler one.");
}
