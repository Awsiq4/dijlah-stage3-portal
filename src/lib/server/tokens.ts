import {createHmac} from "node:crypto";

export type SubscribeTokenPayload = {section: "A"|"B"|"C"|"F"};

const SECTIONS = ["A","B","C","F"] as const;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signSubscribeToken(section: string, secret: string, ttlSeconds: number, now = Date.now()): string {
  if (!SECTIONS.includes(section as never)) throw new Error("invalid section");
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const body = `s1.${section}.${exp}`;
  const sig = createHmac("sha256", secret).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifySubscribeToken(token: string, secret: string, now = Date.now()): SubscribeTokenPayload | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "s1") return null;
  const [, section, expStr, sig] = parts;
  if (!SECTIONS.includes(section as never)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;
  const body = `s1.${section}.${exp}`;
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  if (diff !== 0) return null;
  if (Math.floor(now / 1000) > exp) return null;
  return {section: section as SubscribeTokenPayload["section"]};
}
