import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

// Prevent the old production regression: portal_exams.date is TEXT, while
// PostgreSQL CURRENT_DATE is DATE; the two cannot be compared directly.
test("Telegram upcoming exams query compares text calendar days in Baghdad",()=>{
 const code=readFileSync(fileURLToPath(new URL("./botx.ts",import.meta.url)),"utf8");
 const examBlock=code.split('if (data === "stu:exams") {')[1]?.split('if (data === "stu:prefs")')[0];
 assert.ok(examBlock,"Student exam menu must remain reachable");
 assert.doesNotMatch(examBlock,/date\s*>=\s*CURRENT_DATE/i);
 assert.match(examBlock,/date\s*>=\s*\$2::text/i);
 assert.match(examBlock,/\[JSON\.stringify\(\[sec\]\),baghdadToday\(\)\]/);
 assert.match(examBlock,/sections\s*@>\s*\$1::jsonb/);
 assert.match(examBlock,/status\s*<>\s*'cancelled'/);
 assert.match(examBlock,/LEFT\(due_at,10\)\s*>=\s*\$2::text/);
});
