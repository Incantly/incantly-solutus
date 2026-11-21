/** A figure's picture: an SVG data URL (PNG for 3D) made from an app, for placeholders and exports. Never throws. */
import type { App, AppModeId, ExportEnv } from '@incantly/sdk';

/** A picture over this many characters is not stored in the document (design 2: `picture` is a cache). */
export const PICTURE_LIMIT = 256 * 1024;

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type PictureResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

/** The picture of `app` at `width` by `height` pixels, or the reason it could not be made. */
export async function makePicture(app: App, mode: AppModeId, width: number, height: number, env?: ExportEnv): Promise<PictureResult> {
  try {
    const png = mode === 'graphing3d';
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const r = await app.export(png ? { format: 'png', width: w, height: h, view: '3d' } : { format: 'svg', width: w, height: h }, env);
    if (!r.ok) return { ok: false, reason: r.message };
    let url: string;
    if (png) url = `data:image/png;base64,${base64(new Uint8Array(await r.blob.arrayBuffer()))}`;
    else url = `data:image/svg+xml;base64,${base64(new TextEncoder().encode(r.text ?? (await r.blob.text())))}`;
    if (url.length > PICTURE_LIMIT) return { ok: false, reason: `The picture is ${Math.ceil(url.length / 1024)} KB; the limit is ${PICTURE_LIMIT / 1024} KB.` };
    return { ok: true, url };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The picture could not be made.' };
  }
}

/** The picture, or `undefined` when it cannot be made or is too large. */
export async function pictureOf(app: App, mode: AppModeId, width: number, height: number, env?: ExportEnv): Promise<string | undefined> {
  const r = await makePicture(app, mode, width, height, env);
  return r.ok ? r.url : undefined;
}
