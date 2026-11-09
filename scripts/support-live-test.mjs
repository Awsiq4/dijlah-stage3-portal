// Runs exclusively against an explicitly supplied isolated database. Never uses DATABASE_URL implicitly.
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const memory=process.argv.includes('--memory');
console.log(memory?'Using isolated in-memory PostgreSQL emulation':'Provide isolated test connection on stdin (hidden):');
let url='postgres://test';
if(!memory){const rl=createInterface({input:process.stdin});[url]=await new Promise(resolve=>rl.once('line',l=>resolve([l])));rl.close();}
process.env.DATABASE_URL=url; process.env.SESSION_SECRET='isolated-support-test';
const {q,qOne}=await import('../src/lib/server/db.ts');
const S=await import('../src/lib/server/support.ts');
if(memory){
 const {newDb,DataType}=await import('pg-mem'); const mem=newDb();
 mem.public.registerFunction({name:'octet_length',args:[DataType.bytea],returns:DataType.integer,implementation:b=>b.length});
 const {Pool}=mem.adapters.createPg(); (await import('../src/lib/server/db.ts')).setPoolForTests(new Pool());
 await q(`CREATE TABLE portal_admins(id BIGSERIAL PRIMARY KEY,name TEXT,email TEXT,role TEXT,status TEXT,is_active BOOLEAN,assigned_section TEXT,assigned_subjects JSONB,perms JSONB);CREATE TABLE portal_telegram_links(id BIGSERIAL PRIMARY KEY,admin_id BIGINT,telegram_user_id BIGINT,revoked_at TIMESTAMPTZ);CREATE TABLE tg_subscribers(chat_id BIGINT PRIMARY KEY,first_name TEXT,last_name TEXT,username TEXT,reg_seq BIGINT,section TEXT,role TEXT,status TEXT,registered_at TIMESTAMPTZ);CREATE TABLE portal_login_attempts(key TEXT PRIMARY KEY,count INTEGER,reset_at TIMESTAMPTZ);`);
}
const sql=readFileSync(new URL('../database/support.sql',import.meta.url),'utf8');
for(let i=0;i<(memory?1:2);i++)for(const part of sql.split(';').map(s=>s.trim()).filter(Boolean))await q(part);
const experienceSql=readFileSync(new URL('../database/support-experience.sql',import.meta.url),'utf8');
for(let i=0;i<(memory?1:2);i++)for(const part of experienceSql.split(';').map(s=>s.trim()).filter(Boolean))await q(part);
let passed=0;const ok=(v,label)=>{assert.ok(v,label);passed++;console.log('PASS '+label);};
const owner={owner:true,permissions:[]},key=randomUUID();
const identity=await S.anonymousIdentity(randomUUID());const student={owner:false,permissions:[],identity};
const outsider={owner:false,permissions:[],identity:await S.anonymousIdentity(randomUUID())};
const file={name:'safe.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nfixture\n%%EOF').toString('base64')};
const t=await S.createTicket(student,{category:'problem',subject:'TEST support '+key,body:'اختبار طلب دعم خاص',key,source:'web',file,section:'B'});
ok(t.id>0,'web ticket created');
ok((await S.createTicket(student,{category:'problem',subject:'TEST repeat',body:'duplicate',key,source:'web'})).id===t.id,'idempotent creation');
await assert.rejects(()=>S.getTicket(outsider,t.id));passed++;console.log('PASS anonymous IDOR denied');
let detail=await S.getTicket(student,t.id);ok(detail.messages.length===1,'one initial message');
const initialSeen=await qOne('SELECT last_read_id FROM support_read_states WHERE ticket_id=$1 AND reader_key=$2',
 [t.id,'student:'+identity]);
ok(Number(initialSeen?.last_read_id)>0,'opening a ticket marks it seen for the visitor');
ok(detail.attachments.length===1,'attachment saved');
await assert.rejects(()=>S.attachment(outsider,detail.attachments[0].id));passed++;
ok((await S.attachment(student,detail.attachments[0].id)).bytes.length>0,'attachment ownership');
assert.throws(()=>S.validateAttachment({...file,mime:'image/png'}));passed++;
assert.throws(()=>S.validateAttachment({...file,base64:Buffer.alloc(2097153).toString('base64')}));passed++;
await S.reply(owner,t.id,'رد من المالك',randomUUID());await S.reply(owner,t.id,'ملاحظة داخلية خاصة',randomUUID(),true);
detail=await S.getTicket(student,t.id);ok(detail.messages.length===2,'internal notes hidden from student');
ok((await S.getTicket(owner,t.id)).messages.length===3,'owner sees internal notes');
const ownDetail=await S.getTicket(owner,t.id);
ok(ownDetail.studentProfile===null,'unlinked website visitor is not falsely identified as a Telegram student');
ok(ownDetail.messages.some(m=>m.sender_type==='admin'&&!m.internal),'admin reply is server-labeled distinctly');
ok(ownDetail.messages.some(m=>m.sender_type==='internal'),'internal note is server-labeled distinctly');
ok(!('author' in ownDetail.messages[0]),'raw staff identifiers are not leaked in support messages');
ok(!('studentProfile' in await S.getTicket(student,t.id)),'student never receives staff-only Telegram metadata');

const replyKey=randomUUID();await S.reply(student,t.id,'رد الطالب',replyKey);await S.reply(student,t.id,'رد الطالب',replyKey);
ok((await S.getTicket(student,t.id)).messages.length===3,'reply deduplicated');
await S.changeStatus(owner,t.id,'resolved');await S.changeStatus(student,t.id,'progress');ok((await S.getTicket(student,t.id)).ticket.status==='progress','student reopens resolved ticket');
await S.changeStatus(student,t.id,'closed');await assert.rejects(()=>S.reply(student,t.id,'blocked',randomUUID()));passed++;
await S.changeStatus(owner,t.id,'progress');
await assert.rejects(()=>S.changeStatus(outsider,t.id,'closed'));passed++;
if(!memory) ok((await S.listTickets(owner,{q:key})).rows.some(x=>x.id===t.id),'search finds ticket');
if(!memory) ok(!(await S.listTickets(outsider,{q:key})).rows.some(x=>x.id===t.id),'search respects ownership');
if(!memory) ok((await S.listTickets(owner,{q:key,section:'A'})).rows.length===0,'section filter');
await assert.rejects(()=>S.analytics(student));passed++;
if(!memory) ok(Number((await S.analytics(owner)).summary.total)>0,'analytics from real records');

const knownIdentity = await S.anonymousIdentity(randomUUID());
await q('UPDATE support_identities SET telegram_id=$2 WHERE id=$1',[knownIdentity,88776655]);
await q(`INSERT INTO tg_subscribers(chat_id,first_name,last_name,username,reg_seq,section,role,status,registered_at)
 VALUES(88776655,'Test','Student','teststudent',7,'B','student','active',now())`);
const knownStudent={owner:false,permissions:[],identity:knownIdentity};
const knownTicket=await S.createTicket(knownStudent,{category:'idea',subject:'Known verified student',body:'Student message',key:randomUUID(),source:'web'});
const knownOwnerDetail=await S.getTicket(owner,knownTicket.id);
ok(knownOwnerDetail.studentProfile?.verified===true,'previous verified Telegram identity is discovered without new linking');
ok(knownOwnerDetail.studentProfile?.telegram_id==='88776655','correct Telegram ID shown to authorized support');
ok(knownOwnerDetail.studentProfile?.username==='teststudent','Telegram username shown only to support');
ok(knownOwnerDetail.studentProfile?.section==='B','academic section is inherited only from the verified Telegram account');
ok(!('studentProfile' in await S.getTicket(knownStudent,knownTicket.id)),'verified Telegram metadata stays private to staff');
const recoveryCode=await S.issueRecoveryCode(student);
ok(/^[a-f0-9]{64}$/.test(recoveryCode),'recovery code is cryptographically random and copyable');
const newBrowserSecret=randomUUID();
const newBrowserIdentity=await S.anonymousIdentity(newBrowserSecret);
await S.recoverBrowserIdentity(newBrowserIdentity,newBrowserSecret,recoveryCode);
ok(await S.anonymousIdentity(newBrowserSecret)===identity,'website-only recovery restores prior student tickets');
await assert.rejects(()=>S.recoverBrowserIdentity(newBrowserIdentity,newBrowserSecret,recoveryCode));passed++;
console.log('PASS recovery code cannot be reused');

await q("INSERT INTO portal_admins(id,name,email,role,status,is_active) VALUES(1,'Site Owner','owner@example.test','super_admin','active',true)");
const siteOwner=await S.adminActor({id:1,email:'owner@example.test',role:'super_admin',is_active:true});
ok(siteOwner.owner===true,'site super admin manages support without Telegram account linkage');
ok(typeof S.createLink==='undefined'&&typeof S.bindLink==='undefined'&&typeof S.telegramActor==='function',
  'legacy website account linking remains disabled; verified Telegram webhook actors supported');
await assert.rejects(()=>S.createTicket(student,{category:'idea',subject:'Unallowed bot ticket',body:'Test only',key:randomUUID(),source:'telegram'}));passed++;
console.log('PASS Telegram support submissions refused');
// Mimic PostgreSQL's strict prepared-statement parameter count for both roles.
// pg-mem does not check extra bind parameters, which hid the production bug.
const testPool=(await import('../src/lib/server/db.ts')).getPool();
const queryOriginal=testPool.query.bind(testPool);
const seenPages=[];
testPool.query=async (sql,params=[])=>{
  if (/ORDER BY t\.updated_at DESC,t\.id DESC\s+LIMIT/.test(String(sql))) {
    const placeholders=[...String(sql).matchAll(/\$(\d+)/g)].map(match=>Number(match[1]));
    assert.equal(Math.max(...placeholders),params.length,'PostgreSQL bind argument count matches placeholders');
    assert.equal(params.at(-2),10,'page size parameter included');
    assert.equal(params.at(-1),10,'page offset bound for requested second page');
    seenPages.push(params.length);
    return {rows:[]};
  }
  if(String(sql).includes("AS pending") && String(sql).includes("AS waiting")
      && String(sql).includes("FROM support_tickets t")){
    return {rows:[{pending:1,waiting:1,done:1}]};
  }
  return queryOriginal(sql,params);
};
try {
  await S.listTickets(student,{page:'1'});
  await S.listTickets(owner,{page:'1'});
} finally {testPool.query=queryOriginal;}
ok(seenPages.length===2,'pagination uses valid prepared parameters for visitor and owner');
const jobs=await qOne('SELECT count(*)::int AS total FROM support_jobs');
ok(Number(jobs.total)===0,'legacy website ticket operations do not enqueue Telegram notifications');
console.log('Support integration: '+passed+' PASS; '+(memory?'pg-mem':'isolated real PostgreSQL')+'; website-only, no Telegram integration.');
const pool=(await import('../src/lib/server/db.ts')).getPool();await pool.end();
