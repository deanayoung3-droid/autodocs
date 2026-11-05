import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Bucket } from "@google-cloud/storage";
import { DATA_DIR } from "./db";

// Files: screenshots, uploaded images, and images brought over by an import. In production they
// live in a Cloud Storage bucket (GCS_BUCKET, reached with the service's own identity); locally,
// in DATA_DIR/files. Either way they're served at /files/<key>, so article Markdown never
// depends on where they're stored.

const LOCAL_DIR = path.join(DATA_DIR, "files");

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export const IMAGE_EXTENSIONS = Object.keys(TYPES);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

let bucket: Bucket | null = null;

async function gcs(): Promise<Bucket | null> {
  if (!process.env.GCS_BUCKET) return null;
  if (!bucket) {
    const { Storage } = await import("@google-cloud/storage");
    bucket = new Storage().bucket(process.env.GCS_BUCKET);
  }
  return bucket;
}

/** Keys are generated here, so a valid one is short, lowercase, and never climbs out of its folder. */
export function validKey(key: string): boolean {
  return /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z0-9]+$/.test(key) && key.length < 200 && !key.includes("..");
}

export function contentTypeFor(key: string): string | null {
  return TYPES[key.split(".").pop() ?? ""] ?? null;
}

/** A fresh, unguessable key like "screenshots/2026/11/3f9a….png". */
export function newKey(folder: string, ext: string): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${folder}/${month}/${crypto.randomBytes(12).toString("hex")}.${ext.toLowerCase().replace("jpeg", "jpg")}`;
}

export const fileUrl = (key: string) => `/files/${key}`;

export async function putFile(key: string, body: Buffer, contentType?: string): Promise<string> {
  if (!validKey(key)) throw new Error(`Invalid file key: ${key}`);
  const type = contentType ?? contentTypeFor(key) ?? "application/octet-stream";
  const b = await gcs();
  if (b) {
    await b.file(key).save(body, { contentType: type, resumable: false, metadata: { cacheControl: "public, max-age=31536000, immutable" } });
  } else {
    const file = path.join(LOCAL_DIR, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
  return fileUrl(key);
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const type = contentTypeFor(key);
  if (!validKey(key) || !type) return null;
  const b = await gcs();
  try {
    if (b) {
      const [body] = await b.file(key).download();
      return { body, contentType: type };
    }
    return { body: await fs.readFile(path.join(LOCAL_DIR, key)), contentType: type };
  } catch {
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (!validKey(key)) return;
  const b = await gcs();
  if (b) await b.file(key).delete({ ignoreNotFound: true });
  else await fs.rm(path.join(LOCAL_DIR, key), { force: true });
}

/** Checks an image's real format from its first bytes, not its name. Returns the extension. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  return null;
}
