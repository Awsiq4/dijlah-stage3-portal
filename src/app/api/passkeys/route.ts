import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransport, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {NextRequest, NextResponse} from "next/server";
import {checkLoginRateLimit, createSession, getAdminFromToken, requireAdmin, SESSION_COOKIE, SESSION_TTL_SECONDS, sha256Hex, verifyPassword} from "@/lib/server/auth";
import {audit, auditBestEffort} from "@/lib/server/content";
import {q, qOne, withTx} from "@/lib/server/db";
import {verifyOwnerLogin} from "@/lib/server/owner-mfa";
import {canUsePasskeys, consumePasskeyChallenge, issuePasskeyChallenge, MAX_PASSKEYS, PASSKEY_ORIGIN, PASSKEY_RP_ID, PASSKEY_TTL, passkeyUserId} from "@/lib/server/passkeys";

export const dynamic = "force-dynamic";

const AUTH_COOKIE = "__Host-portal_passkey_auth";
const REGISTER_COOKIE = "__Host-portal_passkey_register";
const ceremonyCookie = {httpOnly: true, secure: true, sameSite: "strict", path: "/"} as const;
const expected = {expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID, requireUserVerification: true};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {status, headers: {"Cache-Control": "private, no-store"}});
}

function failure(error: string, status: number) {
  return json({error}, status);
}

function credentialId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,1400}$/.test(value);
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.origin !== PASSKEY_ORIGIN) return failure("افتح البوابة عبر dj3.top لإدارة مفاتيح الدخول.", 403);
  const admin = await requireAdmin(req);
  if (!admin || !canUsePasskeys(admin.role)) return failure("سجّل الدخول لإدارة مفاتيحك.", 401);
  const keys = await q("SELECT id,label,created_at,last_used_at FROM portal_passkeys WHERE admin_id=$1 ORDER BY created_at DESC", [admin.id]);
  return json({keys});
}

async function authenticate(req: NextRequest, body: Record<string, unknown>) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!await checkLoginRateLimit(`passkey:${body.action}:${ip}`, 30, 5 * 60_000)) return failure("محاولات كثيرة. انتظر قليلاً ثم جرّب مجدداً.", 429);
  if (body.action === "login-options") {
    const options = await generateAuthenticationOptions({rpID: PASSKEY_RP_ID, userVerification: "required", timeout: 90_000});
    const res = json({options});
    res.cookies.set(AUTH_COOKIE, await issuePasskeyChallenge("authenticate", options.challenge), {...ceremonyCookie, maxAge: PASSKEY_TTL});
    return res;
  }

  const challenge = await consumePasskeyChallenge("authenticate", req.cookies.get(AUTH_COOKIE)?.value);
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!challenge || !credentialId(response?.id)) return failure("انتهت محاولة الدخول. أعد المحاولة.", 400);
  const keyOwner = await qOne<{admin_id: number}>("SELECT admin_id FROM portal_passkeys WHERE id=$1", [response.id]);
  if (!keyOwner) return failure("مفتاح الدخول غير متاح لهذا الحساب.", 401);
  const signedIn = await withTx(async db => {
    // Lock the account first, in the same order used by registration and revocation.
    const account = await db.qOne<{id: number; role: string; email: string}>(
      "SELECT id,role,email FROM portal_admins WHERE id=$1 AND is_active AND status='active' FOR UPDATE", [keyOwner.admin_id]
    );
    if (!account || !canUsePasskeys(account.role)) return null;
    const key = await db.qOne<{id: string; public_key: Buffer; counter: string; transports: AuthenticatorTransport[]}>(
      "SELECT id,public_key,counter,transports FROM portal_passkeys WHERE id=$1 AND admin_id=$2 AND ($3 <> 'super_admin' OR enrolled_as_owner)", [response.id, account.id, account.role]
    );
    const handle = response.response?.userHandle;
    if (!key || handle !== passkeyUserId(account.id).toString("base64url")) return null;
    const verification = await verifyAuthenticationResponse({
      ...expected, response, expectedChallenge: challenge.challenge,
      credential: {id: key.id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports},
    }).catch(() => null);
    if (!verification?.verified) return null;
    await db.q("UPDATE portal_passkeys SET counter=$2,last_used_at=now() WHERE id=$1", [key.id, verification.authenticationInfo.newCounter]);
    await db.q("UPDATE portal_admins SET last_login_at=now() WHERE id=$1", [account.id]);
    const token = await createSession(account.id, db, account.role === "super_admin");
    await db.q("UPDATE portal_sessions SET passkey_id=$2 WHERE token_hash=$1", [sha256Hex(token), key.id]);
    return {token, email: account.email};
  });
  if (!signedIn) return failure("تعذّر التحقق من مفتاح الدخول. جرّب مجدداً أو ادخل بالطريقة المعتادة.", 401);
  await auditBestEffort(signedIn.email, "admin.login.passkey", {});
  const res = json({ok: true});
  res.cookies.set(AUTH_COOKIE, "", {...ceremonyCookie, maxAge: 0});
  res.cookies.set(SESSION_COOKIE, signedIn.token, {httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: SESSION_TTL_SECONDS});
  return res;
}

async function manage(req: NextRequest, body: Record<string, unknown>) {
  const admin = await requireAdmin(req);
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!admin || !session || !canUsePasskeys(admin.role)) return failure("سجّل الدخول لإدارة مفاتيحك.", 401);
  const sessionHash = sha256Hex(session);

  if (body.action === "register-options") {
    if (!await checkLoginRateLimit(`passkey:register:${admin.id}`, 10, 10 * 60_000)) return failure("محاولات كثيرة. انتظر قليلاً ثم جرّب مجدداً.", 429);
    if (typeof body.password !== "string" || !body.password || body.password.length > 1024) return failure("أدخل كلمة مرور الحساب.", 400);
    const password = body.password;
    const snapshot = await qOne<{password_hash: string}>("SELECT password_hash FROM portal_admins WHERE id=$1", [admin.id]);
    if (!snapshot || !await verifyPassword(password, snapshot.password_hash)) return failure("تعذّر تأكيد بيانات الحساب.", 401);

    const keys = await withTx(async db => {
      const current = await db.qOne<{role: string}>(
        "SELECT role FROM portal_admins WHERE id=$1 AND password_hash=$2 AND is_active AND status='active' FOR UPDATE",
        [admin.id, snapshot.password_hash]
      );
      if (!current || !canUsePasskeys(current.role) || !await getAdminFromToken(session, db)) return null;
      const existing = await db.q<{id: string}>("SELECT id FROM portal_passkeys WHERE admin_id=$1", [admin.id]);
      if (existing.length >= MAX_PASSKEYS) return existing;
      if (current.role === "super_admin") {
        const code = body.code;
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
        const verified = await verifyOwnerLogin(db, admin.id, {code, enrollmentToken: "", existingCode: ""});
        if (verified.kind !== "verified") return null;
      }
      return existing;
    });
    if (!keys) return failure("تعذّر التأكيد. للمالك، استخدم رمزاً جديداً من تطبيق المصادقة.", 401);
    if (keys.length >= MAX_PASSKEYS) return failure("وصلت إلى الحد الأقصى لمفاتيح الدخول.", 409);
    const options = await generateRegistrationOptions({
      rpName: "بوابة دجلة", rpID: PASSKEY_RP_ID, userName: admin.email, userDisplayName: admin.name || admin.email,
      userID: new Uint8Array(passkeyUserId(admin.id)), attestationType: "none", timeout: 90_000,
      authenticatorSelection: {residentKey: "required", userVerification: "required"},
      excludeCredentials: keys.map(key => ({id: key.id})),
    });
    const res = json({options});
    res.cookies.set(REGISTER_COOKIE, await issuePasskeyChallenge("register", options.challenge, sessionHash), {...ceremonyCookie, maxAge: PASSKEY_TTL});
    return res;
  }

  if (body.action === "register") {
    const response = body.response as RegistrationResponseJSON | undefined;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!credentialId(response?.id) || !label || label.length > 60) return failure("أدخل اسماً صالحاً للمفتاح.", 400);
    const challenge = await consumePasskeyChallenge("register", req.cookies.get(REGISTER_COOKIE)?.value, sessionHash);
    if (!challenge) return failure("انتهت محاولة الإعداد. أعد المحاولة.", 400);
    const verified = await verifyRegistrationResponse({...expected, response, expectedChallenge: challenge.challenge}).catch(() => null);
    if (!verified?.verified || !verified.registrationInfo) return failure("تعذّر تسجيل المفتاح.", 400);
    const key = verified.registrationInfo.credential;
    const added = await withTx(async db => {
      await db.qOne("SELECT id FROM portal_admins WHERE id=$1 FOR UPDATE", [admin.id]);
      const current = await getAdminFromToken(session, db);
      if (!current || !canUsePasskeys(current.role)) return false;
      const count = await db.qOne<{n: number}>("SELECT count(*)::int AS n FROM portal_passkeys WHERE admin_id=$1", [admin.id]);
      if (!count || count.n >= MAX_PASSKEYS) return false;
      const inserted = await db.qOne(
        `INSERT INTO portal_passkeys (id,admin_id,public_key,counter,transports,label,enrolled_as_owner)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [key.id, admin.id, Buffer.from(key.publicKey), key.counter, key.transports ?? [], label, current.role === "super_admin"]
      );
      if (inserted) await audit(admin.email, "admin.passkey.added", {}, db);
      return Boolean(inserted);
    });
    if (!added) return failure("تعذّر إضافة المفتاح أو أنه مسجّل مسبقاً.", 409);
    const res = json({ok: true});
    res.cookies.set(REGISTER_COOKIE, "", {...ceremonyCookie, maxAge: 0});
    return res;
  }

  if (body.action !== "remove" || !credentialId(body.id)) return failure("طلب غير صالح.", 400);
  const removed = await withTx(async db => {
    await db.qOne("SELECT id FROM portal_admins WHERE id=$1 FOR UPDATE", [admin.id]);
    const current = await getAdminFromToken(session, db);
    if (!current || !canUsePasskeys(current.role)) return false;
    const key = await db.qOne("DELETE FROM portal_passkeys WHERE id=$1 AND admin_id=$2 RETURNING id", [body.id, admin.id]);
    if (!key) return false;
    await db.q("UPDATE portal_sessions SET revoked_at=now() WHERE passkey_id=$1 AND admin_id=$2 AND revoked_at IS NULL", [body.id, admin.id]);
    await audit(admin.email, "admin.passkey.removed", {}, db);
    return true;
  });
  if (!removed) return failure("مفتاح الدخول غير متاح.", 404);
  return json({ok: true, signedOut: !await getAdminFromToken(session)});
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.origin !== PASSKEY_ORIGIN || req.headers.get("origin") !== PASSKEY_ORIGIN) return failure("طلب غير مسموح.", 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure("طلب غير صالح.", 400);
    return body.action === "login-options" || body.action === "login"
      ? await authenticate(req, body) : await manage(req, body);
  } catch {
    return failure("تعذّر إكمال العملية. جرّب مجدداً.", 503);
  }
}
