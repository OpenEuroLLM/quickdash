// Run against an explicitly preserved checkout; never embeds or publishes result data.
// QUICKDASH_BASELINE=/path/to/checkout node tests/compare_baseline.cjs output/analysis.json
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const baseline=process.env.QUICKDASH_BASELINE;
if(!baseline)throw Error('Set QUICKDASH_BASELINE to the checkout being compared');
const before=require(path.resolve(baseline,'app/app.js'));
const after=require('../app/analysis.js'),S=require('../app/suite_config.js');
const data=JSON.parse(fs.readFileSync(process.argv[2]||'output/example/analysis.json','utf8'));
const normalized=t=>({score:t.score,evals:t.evals.map(e=>({name:e.name,score:e.aggregateScore,weight:e.weight,contribution:e.contribution,excluded:e.excluded})),categories:t.categories,rowWeights:[...t.rowWeights].map(([r,w])=>[before.key?before.key(r):JSON.stringify(['task','metric','filter','n_shot','harness','backend'].map(k=>r[k])),w])});
function close(a,b){if(typeof a==='number'){assert.ok(Math.abs(a-b)<1e-9);}else if(Array.isArray(a)){assert.equal(a.length,b.length);a.forEach((v,i)=>close(v,b[i]));}else if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a),Object.keys(b));for(const k of Object.keys(a))close(a[k],b[k]);}else assert.equal(a,b);}
let cases=0;
for(const {config:profile} of data.profiles)for(const {config:suite} of data.suites)for(const aggregate of ['standard','english_eval','english_category']){
 const scheme=S.resolveConfig(data.catalogue,suite,{...profile,aggregate});
 const original=before.auditRows(data.rows,data.catalogue),model=original[0]?.checkpoint;
 const a=S.scopeRows(original.filter(r=>r.checkpoint===model),suite).rows;
 const full=before.synthetic(a,scheme);
 for(const b of [full,full.slice(1),full.filter(r=>r.eval!==full[0]?.eval),full.map((r,i)=>i? r:{...r,backend:'different'})]){
  const old=before.comparisonCoverage(a,b,scheme),now=after.comparisonCoverage(a,b,scheme);
  assert.deepEqual(now.a,old.a);assert.deepEqual(now.b,old.b);
  for(const side of ['a','b'])close(normalized(before.totals(old[side],scheme,scheme.weights,aggregate)),normalized(after.totals(now[side],scheme,scheme.weights,aggregate)));
  for(const view of ['category','language']){
   const metadata=new Map(data.metadata.map(r=>[r.task,r]));
   close(before.buildBreakdownTree(old.pairs,metadata,view,'','',scheme),after.buildBreakdownTree(now.pairs,metadata,view,'','',scheme));
  }
  cases++;
 }
}
console.log(`Before/after comparison passed: ${cases} combinations of profiles, sets, modes and missing coverage; identical included rows, scores, weights, contributions and descriptive trees.`);
