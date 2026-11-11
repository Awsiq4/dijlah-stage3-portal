import {test} from "node:test";
import assert from "node:assert/strict";
import {signSubscribeToken, verifySubscribeToken} from "./tokens.ts";
import {selectRecipients, eventKey} from "./targeting.ts";
import {renderMessage} from "./templates.ts";
import {nextDelayMs, shouldRetry, isBlockedError, MAX_ATTEMPTS} from "./backoff.ts";

const SECRET = "test-secret-123";

test("token: sign+verify roundtrip", () => {
  const t = signSubscribeToken("B", SECRET, 900, 1_000_000);
  assert.deepEqual(verifySubscribeToken(t, SECRET, 1_000_000 + 500_000), {section: "B"});
});

test("token: rejects tampering, wrong secret, expiry, bad section", () => {
  const t = signSubscribeToken("A", SECRET, 900, 1_000_000);
  assert.equal(verifySubscribeToken(t.replace("s1.A", "s1.C"), SECRET, 1_000_000), null);
  assert.equal(verifySubscribeToken(t, "other-secret", 1_000_000), null);
  assert.equal(verifySubscribeToken(t, SECRET, 1_000_000 + 901_000), null);
  assert.throws(() => signSubscribeToken("X", SECRET, 60));
  assert.equal(verifySubscribeToken("garbage", SECRET), null);
  assert.equal(verifySubscribeToken(t, "", 1_000_000), null);
});

test("targeting: section event only reaches that section", () => {
  const subs = [
    {id: 1, chat_id: 1, section: "A", status: "active", prefs: {}},
    {id: 2, chat_id: 2, section: "B", status: "active", prefs: {}},
    {id: 3, chat_id: 3, section: "A", status: "stopped", prefs: {}},
    {id: 4, chat_id: 4, section: "A", status: "active", prefs: {announcements: false}},
  ];
  const ev = {type: "announcement", scope: "section", section: "A"};
  const got = selectRecipients(ev, subs).map(s => s.id);
  assert.deepEqual(got, [1]);
  const gen = selectRecipients({type: "announcement", scope: "general"}, subs).map(s => s.id);
  assert.deepEqual(gen.sort(), [1, 2]);
});

test("targeting: prefs off excludes, duplicates impossible", () => {
  const subs = [
    {id: 1, chat_id: 1, section: "A", status: "active", prefs: {lectures: false}},
    {id: 1, chat_id: 1, section: "A", status: "active", prefs: {}},
  ];
  assert.equal(selectRecipients({type: "lecture", scope: "general"}, subs).length, 1);
});

test("eventKey is deterministic", () => {
  assert.equal(eventKey("lecture", "lec-1", 2), "lecture:lec-1:v2");
});

test("templates: render Arabic message with portal link, escapes HTML", () => {
  const m = renderMessage({type: "announcement", scope: "section", section: "A", priority: "urgent", title: "<b>test</b>", body: "hello", url: "/announcements"}, "https://portal.example");
  assert.match(m.text, /تبليغ|🔴/);
  assert.ok(m.text.includes("&lt;b&gt;test&lt;/b&gt;"));
  assert.ok(m.text.includes("https://portal.example/announcements"));
  assert.equal(m.parseMode, "HTML");
});

test("lecture notification: real academic subject, lecture title and canonical direct link", () => {
  const m = renderMessage({
    type: "lecture", scope: "general", title: "محاضرة رقم (1)",
    subjectName: "تطبيقات الليزر الصناعية", body: "",
    url: "/lectures/lec-tg-123",
  }, "https://dj3.top");
  assert.match(m.text, /المادة: <b>تطبيقات الليزر الصناعية<\/b>/);
  assert.match(m.text, /المحاضرة: <b>محاضرة رقم \(1\)<\/b>/);
  assert.match(m.text, /جميع الشعب \(A, B, C, F\)/);
  assert.ok(m.text.includes('href="https://dj3.top/lectures/lec-tg-123"'));
  assert.ok(!m.text.includes("المادة: محاضرة رقم"));
});

test("lecture notification: section targeting and escaped untrusted subject/title", () => {
  const m = renderMessage({
    type: "lecture", scope: "section", section: "F", title: "<New lecture>",
    subjectName: "<Laser & optics>", url: "/lectures/lec-1",
  }, "https://dj3.top");
  assert.ok(m.text.includes("&lt;Laser &amp; optics&gt;"));
  assert.ok(m.text.includes("&lt;New lecture&gt;"));
  assert.ok(m.text.includes("الجمهور: شعبة F"));
  assert.ok(!m.text.includes("جميع الشعب"));
});

test("backoff: exponential with cap, respects retry_after, caps attempts", () => {
  assert.ok(nextDelayMs(1) < nextDelayMs(3));
  assert.ok(nextDelayMs(20) <= 5 * 60 * 1000);
  assert.equal(nextDelayMs(1, 30), 30_000);
  assert.equal(shouldRetry(MAX_ATTEMPTS, {code: 429}), false);
  assert.equal(shouldRetry(1, {code: 429}), true);
  assert.equal(shouldRetry(1, {code: 403}), false);
  assert.equal(isBlockedError({code: 403, description: "bot was blocked by the user"}), true);
});
