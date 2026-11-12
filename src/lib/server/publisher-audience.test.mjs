import {test} from "node:test";
import assert from "node:assert/strict";
import {defaultAudience,validAudience,canPublishScheduledExam} from "./publisher-audience.ts";

const repA={id:2,role:"section_representative",status:"active",is_active:true,assigned_section:"A"};
const repG={id:3,role:"general_representative",status:"active",is_active:true};
const teacher={id:4,role:"teacher",status:"active",is_active:true,
 assigned_subjects:["nonlinear-optics"],perms:{teacher_sections:{"nonlinear-optics":["A","B"]}}};
const owner={id:1,role:"super_admin",status:"active",is_active:true};

test("default publishing audience minimizes prompts without extending permissions",()=>{
 assert.deepEqual(defaultAudience(repA,"nonlinear-optics"),["A"]);
 assert.deepEqual(defaultAudience(repG,"nonlinear-optics"),["A","B","C","F"]);
 assert.deepEqual(defaultAudience(teacher,"nonlinear-optics"),["A","B"]);
 assert.deepEqual(defaultAudience(owner,"nonlinear-optics"),["A","B","C","F"]);
 assert.equal(validAudience(repA,"nonlinear-optics",["B"]),false);
 assert.equal(validAudience(repA,"nonlinear-optics",["A","B"]),false);
 assert.equal(validAudience(repA,"nonlinear-optics",["A","B","C","F"]),true);
 assert.equal(validAudience(teacher,"quantum-mechanics",["A"]),false);
 assert.equal(validAudience(teacher,"nonlinear-optics",["C"]),false);
 assert.equal(validAudience(teacher,"nonlinear-optics",["A","B"]),true);
 assert.equal(validAudience(repG,"nonlinear-optics",["Z"]),false);
 assert.equal(validAudience(repG,"nonlinear-optics",["A","A"]),false);
});
test("Midterm and Final are never scheduled from staff publisher flows",()=>{
 for(const type of ["Midterm","Final","الميدتيرم","الفاينل","نصف السنة"]) {
   assert.equal(canPublishScheduledExam(repA,type),false);
   assert.equal(canPublishScheduledExam(teacher,type),false);
   assert.equal(canPublishScheduledExam(owner,type),true);
 }
 assert.equal(canPublishScheduledExam(repA,"كوز يومي"),true);
});
