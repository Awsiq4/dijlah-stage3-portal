import {test} from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, isActive, canManageUsers, canManageAllContent, canPublishAnnouncement,
  canPublishSubjectContent, canPublishMaterial, canModifyContent, canUseTelegramPublishing, teacherSections,
  newToken, hashToken, tokenMatches, tokenUsable, newLinkToken, linkStartParam, linkStartParamLength,
  canWriteContentRecord,
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

test("S6: Telegram link uses a SHORT single-use token; deep link fits Telegram's 64-char /start limit", () => {
  for (let i = 0; i < 20; i++) {
    const t = newLinkToken();
    assert.ok(t.length <= 22, "token is short");
    const deepLink = `https://t.me/mybot?start=${linkStartParam(t)}`;
    assert.ok(deepLink.length <= 64, `deep link ${deepLink.length} chars <= 64`);
  }
  // stored hashed only; lookup by hash
  const t = newLinkToken();
  assert.equal(tokenMatches(t, hashToken(t)), true);
  assert.equal(tokenMatches(newLinkToken(), hashToken(t)), false);
});

test("webhook auth: disabled flag ignores traffic; enabled requires secret; missing secret rejects all", async () => {
  const {webhookAuthorized} = await import("./flags.ts");
  assert.equal(webhookAuthorized("anything", {botEnabled: false, webhookSecret: "s"}), "disabled");
  assert.equal(webhookAuthorized(null, {botEnabled: true, webhookSecret: ""}), "unauthorized"); // enabled but no secret
  assert.equal(webhookAuthorized("wrong", {botEnabled: true, webhookSecret: "s"}), "unauthorized");
  assert.equal(webhookAuthorized(null, {botEnabled: true, webhookSecret: "s"}), "unauthorized");
  assert.equal(webhookAuthorized("s", {botEnabled: true, webhookSecret: "s"}), "ok");
});

test("content write gate: reps/teachers allowed only within their scope (the RoleWorkspace bug)", () => {
  // section rep CAN publish own-section announcement through the content API gate
  assert.equal(canWriteContentRecord(repA, "announcements", {scope: "section", section: "A"}), true);
  assert.equal(canWriteContentRecord(repA, "announcements", {scope: "section", section: "B"}), false);
  assert.equal(canWriteContentRecord(repA, "announcements", {scope: "general", section: "all"}), false);
  // teacher CAN publish to assigned subject
  assert.equal(canWriteContentRecord(teacher, "lectures", {subject_id: "nonlinear-optics", sections: ["A"]}), true);
  assert.equal(canWriteContentRecord(teacher, "lectures", {subject_id: "quantum-mechanics", sections: ["A"]}), false);
  assert.equal(canWriteContentRecord(teacher, "lectures", {subject_id: "nonlinear-optics", sections: ["C"]}), false);
  // schedule only for privileged roles
  assert.equal(canWriteContentRecord(repA, "schedule", {section: "A"}), false);
  assert.equal(canWriteContentRecord(superAdmin, "schedule", {section: "A"}), true);
  // telegram links management: privileged only
  assert.equal(canWriteContentRecord(repA, "telegram"), false);
  assert.equal(canWriteContentRecord(superAdmin, "telegram"), true);
  // suspended role: nothing
  assert.equal(canWriteContentRecord(suspendedRep, "announcements", {scope: "section", section: "A"}), false);
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

test("M1: materials audience matrix (section rep: own or ALL only; general rep: any; teacher: assigned+permitted)", () => {
  const ALL = ["A", "B", "C", "F"];
  // section rep A: any subject, own section or all sections
  assert.equal(canPublishMaterial(repA, "any-subject", ["A"]), true);
  assert.equal(canPublishMaterial(repA, "any-subject", ALL), true);
  assert.equal(canPublishMaterial(repA, "any-subject", ["B"]), false);      // other single section
  assert.equal(canPublishMaterial(repA, "any-subject", ["A", "B"]), false);  // mixed
  // general rep: any subject, all or single section
  assert.equal(canPublishMaterial(repGen, "any-subject", ALL), true);
  assert.equal(canPublishMaterial(repGen, "any-subject", ["C"]), true);
  // teacher: assigned subject + permitted sections only
  assert.equal(canPublishMaterial(teacher, "nonlinear-optics", ["A"]), true);
  assert.equal(canPublishMaterial(teacher, "nonlinear-optics", ["C"]), false);
  assert.equal(canPublishMaterial(teacher, "quantum-mechanics", ALL), false);
  // super admin: anything
  assert.equal(canPublishMaterial(superAdmin, "x", ["B"]), true);
  // suspended: nothing
  assert.equal(canPublishMaterial(suspendedRep, "any", ALL), false);
  // invalid section rejected
  assert.equal(canPublishMaterial(repGen, "x", ["Z"]), false);
});

test("M2: write gate — rep can publish lectures (materials) but not exams/assignments/schedule", () => {
  assert.equal(canWriteContentRecord(repA, "lectures", {subject_id: "x", sections: ["A", "B", "C", "F"]}), true);
  assert.equal(canWriteContentRecord(repA, "lectures", {subject_id: "x", sections: ["B"]}), false);
  assert.equal(canWriteContentRecord(repA, "exams", {subject_id: "x", sections: ["A"]}), false);
  assert.equal(canWriteContentRecord(repA, "assignments", {subject_id: "x", sections: ["A"]}), false);
});
