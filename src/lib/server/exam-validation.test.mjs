import {test} from "node:test";
import assert from "node:assert/strict";
import {validExamDay,validExamTime,validExamSchedule} from "./exam-validation.ts";

const valid={
  subject_id:"nonlinear-optics",title:"كوز الفصل الأول",type:"كوز يومي",
  date:"2099-11-25",start_time:"",
  sections:["A","B"],status:"confirmed",topics:"الفصل الأول",
};
test("Baghdad exam scheduling validates dates and local clock",()=>{
 assert.equal(validExamDay("2099-11-25"),true);
 assert.equal(validExamDay("2099-02-30"),false);
 assert.equal(validExamDay("2099-13-01"),false);
 assert.equal(validExamTime("09:30"),true);
 assert.equal(validExamTime("24:00"),false);
 assert.equal(validExamTime("9:30"),false);
 assert.equal(validExamSchedule(valid),null);
 assert.equal(validExamSchedule({...valid,type:"Midterm",start_time:""}), "تاريخ الامتحان أو وقته غير صالح");
 assert.equal(validExamSchedule({...valid,type:"Midterm",start_time:"09:30"}),null);
 assert.match(validExamSchedule({...valid,date:"2001-01-01"})||"",/مضى/);
 assert.equal(validExamSchedule({...valid,date:"2001-01-01"},false),null);
});
test("exam audience, subject and status fields cannot be forged",()=>{
 for(const invalid of [
  {...valid,sections:[]},
  {...valid,sections:["A","Z"]},
  {...valid,sections:["A","A"]},
  {...valid,subject_id:""},
  {...valid,title:""},
  {...valid,type:""},
  {...valid,status:"undefined"},
  {...valid,room:"x".repeat(121)},
 ]) assert.notEqual(validExamSchedule(invalid),null);
});
