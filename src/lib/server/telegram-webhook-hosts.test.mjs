import {test} from "node:test";
import assert from "node:assert/strict";
import {
  expectedProductionWebhook,
  isOfficialProductionWebhook,
  isKnownProjectPreviewWebhook,
  decideSupportWebhookAction,
} from "./telegram-webhook-hosts.ts";

const legacy="https://dijlah-stage3-portal.vercel.app/api/telegram/webhook";
const custom="https://dj3.top/api/telegram/webhook";

test("valid production domains remain usable without webhook reconfiguration",()=>{
  assert.equal(expectedProductionWebhook("https://dj3.top"), custom);
  assert.equal(expectedProductionWebhook("https://dijlah-stage3-portal.vercel.app"), legacy);
  assert.equal(decideSupportWebhookAction(legacy),"ready");
  assert.equal(decideSupportWebhookAction(custom),"ready");
  assert.equal(isOfficialProductionWebhook(legacy),true);
  assert.equal(isOfficialProductionWebhook(custom),true);
});

test("known project preview can be repaired, unlike unknown deployments",()=>{
  assert.equal(decideSupportWebhookAction(null),"repair");
  assert.equal(decideSupportWebhookAction(
    "https://dijlah-stage3-portal-g96jys2yr-awsiq4.vercel.app/api/telegram/webhook"),"repair");
  assert.equal(isKnownProjectPreviewWebhook(
    "https://dijlah-stage3-portal-awsiq4.vercel.app/api/telegram/webhook"),true);
  assert.equal(decideSupportWebhookAction("https://unrelated-deploy.vercel.app/api/telegram/webhook"),"untrusted");
});

test("reject malicious lookalikes, credentials, unexpected routes, querystrings and ports",()=>{
  for(const origin of [
    "https://dj3.top.evil.example/api/telegram/webhook",
    "https://dijlah-stage3-portal.vercel.app.evil.com/api/telegram/webhook",
    "http://dj3.top/api/telegram/webhook",
    "https://bad-user@dj3.top/api/telegram/webhook",
    "https://dj3.top:8443/api/telegram/webhook",
    "https://dj3.top/api/telegram/webhook?token=1",
    "https://dj3.top/api/admin",
    "https://dijlah-stage3-portal-fake-awsiq4.vercel.app.evil.com/api/telegram/webhook",
  ]){
    assert.equal(isOfficialProductionWebhook(origin),false,origin);
    assert.equal(isKnownProjectPreviewWebhook(origin),false,origin);
    assert.equal(decideSupportWebhookAction(origin),"untrusted",origin);
  }
  for(const base of [
    "https://dj3.top.evil.com",
    "https://unknown.example",
    "http://dj3.top",
    "https://bad-user@dj3.top",
    "https://dj3.top/api",
    "https://dj3.top?redirect=other",
  ]) assert.equal(expectedProductionWebhook(base),null,base);
});
