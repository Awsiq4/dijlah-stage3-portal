// Phase 1.2 automation: set Vercel env vars for the PR #13 PREVIEW environment only,
// scoped to git branch vibe/phase1-secure-backend-fbb429 via a custom environment.
// SECURITY: secret VALUES are read from process.env or .env.local (gitignored) and are
// NEVER printed, logged, or committed. Generated secrets are persisted only to .env.local.
//
// Usage:
//   VERCEL_TOKEN=... [VERCEL_TEAM_ID=...] [VERCEL_PROJECT=dijlah-stage3-portal] \
//     node scripts/vercel-set-env.mjs
// Prereq: DATABASE_URL in env or .env.local (from the Neon dashboard, pooled connection).
import {readFileSync, existsSync, appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'vibe/phase1-secure-backend-fbb429';
const ENV_SLUG = 'phase1-preview';
const PROJECT = process.env.VERCEL_PROJECT || 'dijlah-stage3-portal';
const TOKEN = process.env.VERCEL_TOKEN || '';
const TEAM = process.env.VERCEL_TEAM_ID || '';

if (!TOKEN) {
  console.error('SKIP: VERCEL_TOKEN is not set in this environment — no authorized Vercel access.');
  console.error('Manual minimum: Vercel dashboard → Project → Settings → Environment Variables → add the keys below with target Preview + branch scope, never Production:');
  console.error('  DATABASE_URL, SESSION_SECRET, ADMIN_API_SECRET, TELEGRAM_BOT_ENABLED=false');
  process.exit(0);
}

// Load .env.local (gitignored) as a fallback source of values; never print them.
const local = {};
const envLocalPath = path.join(root, '.env.local');
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) local[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const get = k => process.env[k] || local[k] || '';
const persistLocal = (k, v) => appendFileSync(envLocalPath, `${k}=${v}\n`);

const DATABASE_URL = get('DATABASE_URL');
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL missing — put it in .env.local (gitignored) or the environment. Not requesting it in chat.'); process.exit(1); }

let SESSION_SECRET = get('SESSION_SECRET');
if (!SESSION_SECRET) { SESSION_SECRET = randomBytes(32).toString('hex'); persistLocal('SESSION_SECRET', SESSION_SECRET); console.log('generated SESSION_SECRET -> .env.local only (value never printed)'); }
let ADMIN_API_SECRET = get('ADMIN_API_SECRET');
if (!ADMIN_API_SECRET) { ADMIN_API_SECRET = randomBytes(32).toString('hex'); persistLocal('ADMIN_API_SECRET', ADMIN_API_SECRET); console.log('generated ADMIN_API_SECRET -> .env.local only (value never printed)'); }

// NOTE: these are written ONLY to the branch-scoped preview custom environment.
// Never add them to Production. Values are never printed.
const VARS = [
  {key: 'DATABASE_URL', value: DATABASE_URL},
  {key: 'SESSION_SECRET', value: SESSION_SECRET},
  {key: 'ADMIN_API_SECRET', value: ADMIN_API_SECRET},
  {key: 'TELEGRAM_BOT_ENABLED', value: 'false'}, // hard guarantee: bot stays disabled
  {key: 'PORTAL_BASE_URL', value: get('PORTAL_BASE_URL') || `https://dijlah-stage3-portal-git-${BRANCH.slice(6, 30)}-awsiq4.vercel.app`},
  {key: 'PORTAL_ALLOWED_ORIGINS', value: get('PORTAL_ALLOWED_ORIGINS') || ''},
  {key: 'BLOB_READ_WRITE_TOKEN', value: get('BLOB_READ_WRITE_TOKEN')}, // optional; required only for PDF uploads
].filter(v => v.value !== '');

const qs = TEAM ? `?teamId=${TEAM}` : '';
const H = {Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json'};
const api = async (method, url, body) => {
  const r = await fetch(url, {method, headers: H, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = {raw: text.slice(0, 200)}; }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${json.error?.message || json.raw || r.statusText}`);
  return json;
};

const project = await api('GET', `https://api.vercel.com/v9/projects/${encodeURIComponent(PROJECT)}${qs}`);
const pid = project.id;
console.log(`project resolved: ${project.name} (${pid})`);

// Ensure a custom preview environment scoped to the PR branch exists.
const envs = await api('GET', `https://api.vercel.com/v1/projects/${pid}/custom-environments${qs}`);
let customEnv = (envs.environments || []).find(e => e.slug === ENV_SLUG && e.gitBranch === BRANCH);
if (!customEnv) {
  customEnv = await api('POST', `https://api.vercel.com/v1/projects/${pid}/custom-environments${qs}`, {
    slug: ENV_SLUG, type: 'preview', gitBranch: BRANCH,
    description: 'Phase 1 secure-backend preview (PR #13) — test DB only, never production',
  });
  console.log(`created custom environment: ${customEnv.slug} (gitBranch=${BRANCH})`);
} else {
  console.log(`custom environment exists: ${customEnv.slug} (gitBranch=${customEnv.gitBranch})`);
}
const customEnvironmentId = customEnv.id;

for (const {key, value} of VARS) {
  const list = await api('GET', `https://api.vercel.com/v10/projects/${pid}/env?key=${encodeURIComponent(key)}${qs ? '&teamId=' + TEAM : ''}`);
  const existing = (list.envs || []).find(e => e.key === key);
  const body = {value, type: 'sensitive', target: ['preview'], customEnvironmentId, description: `Phase 1.2 (branch ${BRANCH})`};
  if (existing) {
    await api('PATCH', `https://api.vercel.com/v10/projects/${pid}/env/${existing.id}${qs}`, body);
    console.log(`updated ${key} -> preview/${ENV_SLUG} (value hidden)`);
  } else {
    await api('POST', `https://api.vercel.com/v10/projects/${pid}/env${qs}`, {key, ...body});
    console.log(`created ${key} -> preview/${ENV_SLUG} (value hidden)`);
  }
}
console.log('Done. Production environment variables were NOT touched. Redeploy the preview afterwards.');
