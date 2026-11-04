import {test} from "node:test";
import assert from "node:assert/strict";
import {mergeById} from "./merge.ts";

const seed=[{id:"a",t:"A"},{id:"b",t:"B"}];

test("stored empty array keeps the seed intact (the 'لايوجد' bug)",()=>{
  assert.deepEqual(mergeById(seed,[]),seed);
});

test("undefined stored list is treated as empty",()=>{
  assert.deepEqual(mergeById(seed,undefined),seed);
});

test("stored entry with same id overrides seed fields, keeps the rest",()=>{
  const out=mergeById(seed,[{id:"a",t:"edited",extra:1}]);
  assert.deepEqual(out,[{id:"a",t:"edited",extra:1},{id:"b",t:"B"}]);
});

test("new ids from storage are appended after the seed entries",()=>{
  const out=mergeById(seed,[{id:"c",t:"C"}]);
  assert.deepEqual(out.map(x=>x.id),["a","b","c"]);
});

test("does not mutate the input arrays",()=>{
  const base=[...seed], over=[{id:"a",t:"x"}];
  const baseCopy=JSON.parse(JSON.stringify(base)), overCopy=JSON.parse(JSON.stringify(over));
  mergeById(base,over);
  assert.deepEqual(base,baseCopy);
  assert.deepEqual(over,overCopy);
});

test("empty seed returns only the stored entries",()=>{
  assert.deepEqual(mergeById([],[{id:"x",v:1}]),[{id:"x",v:1}]);
});

test("works with lecture-shaped objects (subjectId etc.)",()=>{
  const lectures=[{id:"lec-1",subjectId:"nonlinear-optics",title:"L1"}];
  const stored=[{id:"lec-1",status:"draft"}];
  const out=mergeById(lectures,stored);
  assert.equal(out.length,1);
  assert.equal(out[0].title,"L1");
  assert.equal(out[0].status,"draft");
});
