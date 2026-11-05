import {test} from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, isActive, canManageUsers, canManageAllContent, canPublishAnnouncement,
  canPublishSubjectContent, canModifyContent, canUseTelegramPublishing, teacherSections,
  newToken, hashToken, tokenMatches, tokenUsable, signLinkPayload, verifyLinkPayload,
} from "./rbac.ts";

const superAdmin = {id: 1, email: "root@x", role: "super_admin", status: "active", is_active: true};
const repA = {id: 2, email: "repA@x", role: "section_representative", status: "active", is_active: true, assigned_section: "A"};
const repGen = {id: 3, email: "repG@x", role: "general_representative", status: "active", is_active: true};
const teacher = {id: 4, email: "t@x", role: "teacher", status: "active", is_active: true, assigned_subjects: ["nonlinear-optics"], perms: {teacher_sections: {"nonlinear-optics": ["A", "B"]}}};
const suspendedRep = {...repA, id: 5, status: "suspended", is_active: false};

test("S1: section A representative cannot publish to section B (server-side scope)", () => {
  assert.equal(canPublishAnnouncement(repA, "section", "A"), true);
  assert.equal(canPublishAnnouncement(repA, "section", "B"), false);
  assert.equal(canPublishAnnouncement(repA, "section", "C"), false);
  assert.equal(canPublishAnnouncement(repA, "general", "all"), false); // reps cannot publish general
});

test("S2: teacher cannot touch unassigned subjects or unauthorized sections", () => {
  assert.equal(canPublishSubjectContent(teacher, "nonlinear-optics", ["A"]), true);
  assert.equal(canPublishSubjectContent(teacher, "nonlinear-optics", ["A", "B"]), true);
  assert.equal(canPublishSubjectContent(teacher, "nonlinear-optics", ["C"]), false);
  assert.equal(canPublishSubjectContent(teacher, "quantum-mechanics", ["A"]), false); // unassigned subject
  assert.deepEqual(teacherSections(teacher, "nonlinear-optics"), ["A", "B"]);
  assert.equal(teacherSections(teacher, "other"), null); // no mapping = all
});

test("S3: only super_admin can manage users/accounts", () => {
  assert.equal(canManageUsers("super_admin"), true);
  assert.equal(canManageUsers("section_representative"), false);
  assert.equal(canManageUsers("teacher"), false);
  assert.equal(canManageUsers("editor"), false);
});

test("S4: suspended/disabled accounts cannot publish anywhere (web or Telegram)", () => {
  assert.equal(isActive(suspendedRep), false);
  assert.equal(canPublishAnnouncement(suspendedRep, "section", "A"), false);
  assert.equal(canPublishSubjectContent({...teacher, status: "suspended"}, "nonlinear-optics", ["A"]), false);
  assert.equal(canUseTelegramPublishing(suspendedRep), false);
  assert.equal(canUseTelegramPublishing(repA), true);
});

test("S5: invitation/link tokens: single-use, expiring, hash-matched", () => {
  const t = newToken();
  const h = hashToken(t);
  assert.equal(tokenMatches(t, h), true);
  assert.equal(tokenMatches(newToken(), h), false);
  assert.equal(tokenUsable({expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null}), true);
  assert.equal(tokenUsable({expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null}), false); // expired
  assert.equal(tokenUsable({expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: new Date().toISOString()}), false); // used
});

test("S6: forged Telegram link payloads are rejected (wrong secret / tampered / expired)", () => {
  const secret = "link-secret";
  const fixedHash = hashToken("fixed-invitation-token");
  const payload = signLinkPayload(7, fixedHash, secret, 600, 1_000_000_000);
  const v = verifyLinkPayload(payload, secret, 1_000_000_000);
  assert.equal(v?.adminId, 7);
  assert.equal(v?.tokenHash, fixedHash);
  assert.equal(verifyLinkPayload(payload, "other-secret", 1_000_000_000), null);       // wrong secret
  assert.equal(verifyLinkPayload(payload, secret, 1_000_000_000 + 601_000), null);      // expired
  // tamper: flip a signature character in the middle (deterministic, always changes decoded bytes)
  const sigStart = payload.lastIndexOf(".") + 1;
  const mid = sigStart + 8;
  const flipped = payload.slice(0, mid) + (payload[mid] === "A" ? "B" : "A") + payload.slice(mid + 1);
  assert.notEqual(flipped, payload);
  assert.equal(verifyLinkPayload(flipped, secret, 1_000_000_000), null);                // tampered sig
  // tamper: change the adminId inside the signed body
  const bodyTampered = payload.replace("link.7.", "link.8.");
  assert.equal(verifyLinkPayload(bodyTampered, secret, 1_000_000_000), null);
  assert.equal(verifyLinkPayload("garbage", secret, 1_000_000_000), null);
  assert.equal(verifyLinkPayload("", secret, 1_000_000_000), null);
});

test("S7: duplicate publications are impossible (idempotent keys + DO NOTHING inserts)", async () => {
  const {eventKey} = await import("./targeting.ts");
  assert.equal(eventKey("announcement", "ann-1", 1), eventKey("announcement", "ann-1", 1)); // same event -> same key -> UNIQUE constraint blocks dup
  assert.notEqual(eventKey("announcement", "ann-1", 1), eventKey("announcement", "ann-1", 2));
  const {buildUpsert} = await import("./content-schema.ts");
  const u = buildUpsert("announcements", {id: "ann-1", title: "t", scope: "general", section: "all"}, "nothing");
  assert.ok(u.sql.includes("ON CONFLICT (id) DO NOTHING")); // bot re-confirm inserts nothing
});

test("S8: super_admin retains full control (regression)", () => {
  assert.equal(canPublishAnnouncement(superAdmin, "section", "F"), true);
  assert.equal(canPublishAnnouncement(superAdmin, "general", "all"), true);
  assert.equal(canPublishSubjectContent(superAdmin, "anything", ["A", "B", "C", "F"]), true);
  assert.equal(canManageAllContent("super_admin"), true);
  assert.equal(canModifyContent(superAdmin, {created_by: 999}), true);
  assert.equal(canModifyContent(repA, {created_by: 2}), true);   // owner
  assert.equal(canModifyContent(repA, {created_by: 1}), false);  // not owner
});

test("roles list is exactly the supported set", () => {
  assert.deepEqual([...ROLES], ["super_admin", "editor", "viewer", "general_representative", "section_representative", "teacher"]);
});
