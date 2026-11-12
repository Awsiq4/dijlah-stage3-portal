import {randomBytes} from "node:crypto";
import {sha256Hex} from "./auth.ts";
import {q, qOne} from "./db.ts";
import {TELEGRAM_STAFF_ROLES} from "../telegram-roles.ts";

export const PASSKEY_ORIGIN = "https://dj3.top";
export const PASSKEY_RP_ID = "dj3.top";
export const PASSKEY_TTL = 180;
export const MAX_PASSKEYS = 10;

export function canUsePasskeys(role: string): boolean {
  return role === "super_admin" || TELEGRAM_STAFF_ROLES.includes(role);
}

export function passkeyUserId(id: number): Buffer {
  return Buffer.from("dj3-admin:" + id);
}

export async function issuePasskeyChallenge(purpose: "register" | "authenticate", challenge: string, sessionHash?: string) {
  const token = randomBytes(32).toString("base64url");
  await q("DELETE FROM portal_passkey_challenges WHERE expires_at <= now()");
  await q(
    `INSERT INTO portal_passkey_challenges (token_hash,purpose,challenge,session_hash,expires_at)
     VALUES ($1,$2,$3,$4,now()+($5 * interval '1 second'))`,
    [sha256Hex(token), purpose, challenge, sessionHash ?? null, PASSKEY_TTL]
  );
  return token;
}

export async function consumePasskeyChallenge(purpose: "register" | "authenticate", token: string | undefined, sessionHash?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return qOne<{challenge: string}>(
    `DELETE FROM portal_passkey_challenges
     WHERE token_hash=$1 AND purpose=$2 AND session_hash IS NOT DISTINCT FROM $3::text AND expires_at>now()
     RETURNING challenge`,
    [sha256Hex(token), purpose, sessionHash ?? null]
  );
}
