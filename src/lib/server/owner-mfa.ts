import {createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import {hashToken} from "./rbac.ts";
import {withTx, type Queryer} from "./db.ts";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function secretKey(purpose: string): Buffer {
  const secret = process.env.OWNER_MFA_SECRET;
  if (!secret) throw new Error("Owner MFA encryption key unavailable");
  return createHmac("sha256", secret).update("portal-owner-mfa:" + purpose).digest();
}

function base32(seed: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let result = "";
  for (const byte of seed) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(buffer >>> bits) & 31];
    }
  }
  return result;
}

function enrollmentSeed(id: number, token: string): Buffer {
  return createHmac("sha256", secretKey("enrollment")).update(`${id}:${token}`).digest().subarray(0, 20);
}

function encryptSeed(id: number, seed: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey("encryption"), iv);
  cipher.setAAD(Buffer.from(String(id)));
  const data = Buffer.concat([cipher.update(seed), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function decryptSeed(id: number, stored: string): Buffer {
  const data = Buffer.from(stored, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", secretKey("encryption"), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(String(id)));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
}

export function totpCode(seed: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", seed).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function acceptedStep(seed: Buffer, code: string, previous: number, now = Date.now()): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  const value = Buffer.from(code);
  for (const step of [current, current - 1, current + 1]) {
    if (step > previous && timingSafeEqual(Buffer.from(totpCode(seed, step)), value)) return step;
  }
  return null;
}

type MfaState = {
  encrypted_seed: string | null;
  last_step: number;
  recovery_hashes: string[];
  enrollment_hash: string | null;
  enrollment_valid: boolean;
};

function verifyFactor(id: number, state: MfaState, code: string) {
  if (!state.encrypted_seed) return null;
  const normalized = code.trim().toLowerCase().replaceAll("-", "");
  if (/^[0-9a-f]{20}$/.test(normalized)) {
    const digest = hashToken(normalized);
    return state.recovery_hashes.includes(digest)
      ? {step: Number(state.last_step), hashes: state.recovery_hashes.filter(hash => hash !== digest)} : null;
  }
  const step = acceptedStep(decryptSeed(id, state.encrypted_seed), normalized, Number(state.last_step));
  return step === null ? null : {step, hashes: state.recovery_hashes};
}

export async function issueOwnerEnrollment(telegramId: number): Promise<string | null> {
  return withTx(async db => {
    const account = await db.qOne<{id: number}>(
      `SELECT a.id FROM portal_admins a JOIN portal_telegram_links l ON a.id=l.admin_id
       WHERE l.telegram_user_id=$1 AND l.revoked_at IS NULL AND a.role='super_admin'
         AND a.is_active AND a.status='active' FOR UPDATE OF a`, [telegramId]
    );
    if (!account) return null;
    const token = randomBytes(24).toString("base64url");
    await db.q(
      `INSERT INTO portal_owner_mfa (admin_id,enrollment_hash,enrollment_expires_at)
       VALUES ($1,$2,now()+interval '10 minutes')
       ON CONFLICT (admin_id) DO UPDATE SET enrollment_hash=EXCLUDED.enrollment_hash,
          enrollment_expires_at=EXCLUDED.enrollment_expires_at`, [account.id, hashToken(token)]
    );
    return token;
  });
}

type FactorInput = {code: string; enrollmentToken: string; existingCode: string};
export type MfaResult =
  | {kind: "enrollment_required" | "factor_required" | "invalid_factor"}
  | {kind: "configure_authenticator"; setupKey: string}
  | {kind: "verified"; recoveryCodes?: string[]};

// Call after locking the account row and rechecking the current password hash.
export async function verifyOwnerLogin(db: Queryer, id: number, input: FactorInput): Promise<MfaResult> {
  const state = await db.qOne<MfaState>(
    `SELECT encrypted_seed,last_step,recovery_hashes,enrollment_hash,
       COALESCE(enrollment_expires_at > now(),false) AS enrollment_valid
       FROM portal_owner_mfa WHERE admin_id=$1`, [id]
  );
  if (!input.enrollmentToken) {
    if (!state?.encrypted_seed) return {kind: "enrollment_required"};
    if (!input.code) return {kind: "factor_required"};
    const factor = verifyFactor(id, state, input.code);
    if (!factor) return {kind: "invalid_factor"};
    await db.q(`UPDATE portal_owner_mfa SET last_step=$2,recovery_hashes=$3 WHERE admin_id=$1`, [id, factor.step, factor.hashes]);
    return {kind: "verified"};
  }
  if (!/^[A-Za-z0-9_-]{32}$/.test(input.enrollmentToken) || !state?.enrollment_valid ||
      state.enrollment_hash !== hashToken(input.enrollmentToken)) return {kind: "invalid_factor"};
  if (state.encrypted_seed && !verifyFactor(id, state, input.existingCode)) return {kind: "invalid_factor"};
  const seed = enrollmentSeed(id, input.enrollmentToken);
  if (!input.code) return {kind: "configure_authenticator", setupKey: base32(seed)};
  const step = acceptedStep(seed, input.code.trim(), -1);
  if (step === null) return {kind: "invalid_factor"};
  const codes = Array.from({length: 8}, () => randomBytes(10).toString("hex"));
  await db.q(
    `UPDATE portal_owner_mfa SET encrypted_seed=$2,last_step=$3,recovery_hashes=$4,
      enrollment_hash=NULL,enrollment_expires_at=NULL WHERE admin_id=$1`,
    [id, encryptSeed(id, seed), step, codes.map(hashToken)]
  );
  await db.q(`UPDATE portal_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, [id]);
  return {kind: "verified", recoveryCodes: codes.map(code => code.match(/.{5}/g)!.join("-"))};
}
