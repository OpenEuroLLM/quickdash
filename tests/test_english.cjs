const assert=require('node:assert/strict');
const {totals,comparisonRows,pairRows}=require('../app/app.js');
const {validateConfig}=require('../app/eval_config.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const scheme={evals:[{name:'mixed',category:'C'},{name:'english',category:'C'}],weights:{C:1},english_weights:{C:.5},languages:[]};
const rows=[['en','mixed',80],['fr','mixed',20],['de','mixed',40],['english','english',100]].map(([task,ev,score])=>({task,eval:ev,category:'C',score_100:score,raw_score_100:score,metric:'acc',filter:'none',n_shot:'0',harness:'test',backend:'test'}));
const metadata=new Map(rows.map(r=>[r.task,{scope:'single',language:['en','english'].includes(r.task)?'eng_Latn':'fra_Latn'}]));
close(totals(rows,scheme,scheme.weights).score,(140/3+100)/2);
const split=totals(rows,scheme,scheme.weights,'english_category',scheme.english_weights,metadata);
// English=(80+100)/2=90; all other languages=(20+40)/2=30; split=60.
close(split.score,60);close(split.categories[0].englishScore,90);close(split.categories[0].otherScore,30);
close(split.evals.reduce((s,e)=>s+e.contribution,0),60);
close(split.evals.find(e=>e.name==='mixed').weight,.75);
close(totals(rows,scheme,scheme.weights,'english_category',{C:.8},metadata).score,78);
close(totals(rows,scheme,scheme.weights,'english_category',{C:0},metadata).score,totals(rows,scheme,scheme.weights).score);
close(totals(rows,scheme,scheme.weights,'english_category',{C:1},metadata).score,90);
const b=rows.map((r,i)=>({...r,score_100:r.score_100-i-1,raw_score_100:r.raw_score_100-i-1}));
const pairs=pairRows(rows,b),expected=split.score-totals(b,scheme,scheme.weights,'english_category',scheme.english_weights,metadata).score;
for(const group of ['eval','category','variant']){
 const comparisons=comparisonRows(pairs,rows,scheme,scheme.weights,group,'weighted','descending','delta',metadata,'english_category',scheme.english_weights);
 close(comparisons.reduce((s,r)=>s+r.weightedDelta,0),expected);
}
const filtered=comparisonRows(pairs.filter(r=>r.task==='fr'),rows,scheme,scheme.weights,'variant','weighted','descending','delta',metadata,'english_category',scheme.english_weights);
close(filtered[0].weightedDelta,.5); // Original weight .5 / 2 other variants, times delta 2.
close(totals(rows.filter(r=>r.eval!=='english'),scheme,scheme.weights,'english_category',scheme.english_weights,metadata).score,55);
const englishOnly=rows.filter(r=>['en','english'].includes(r.task));
for(const share of [.1,.5,.8,1]){
 const result=totals(englishOnly,scheme,scheme.weights,'english_category',{C:share},metadata);
 close(result.score,90);close(result.categories[0].effectiveEnglishShare,1);assert.equal(result.categories[0].issue,'');
 const otherMetadata=new Map(rows.map(r=>[r.task,{scope:'single',language:'fra_Latn'}]));
 const other=totals(rows,scheme,scheme.weights,'english_category',{C:share},otherMetadata);
 close(other.score,totals(rows,scheme,scheme.weights).score);close(other.categories[0].effectiveEnglishShare,0);
 const otherB=totals(b,scheme,scheme.weights,'english_category',{C:share},otherMetadata);
 close(comparisonRows(pairs,rows,scheme,scheme.weights,'variant','weighted','descending','delta',otherMetadata,'english_category',{C:share}).reduce((sum,r)=>sum+r.weightedDelta,0),other.score-otherB.score);
 const englishB=b.filter(r=>['en','english'].includes(r.task));
 close(comparisonRows(pairRows(englishOnly,englishB),englishOnly,scheme,scheme.weights,'variant','weighted','descending','delta',metadata,'english_category',{C:share}).reduce((sum,r)=>sum+r.weightedDelta,0),90-totals(englishB,scheme,scheme.weights,'english_category',{C:share},metadata).score);
}
const pooled=new Map(metadata);pooled.set('fr',{scope:'pooled',language:'mul'});
close(totals(rows,scheme,scheme.weights,'english_category',scheme.english_weights,pooled).score,57.5);
const translation=new Map(rows.map(r=>[r.task,{scope:'translation',source_language:metadata.get(r.task).language==='eng_Latn'?'fra_Latn':'eng_Latn',target_language:metadata.get(r.task).language}]));
close(totals(rows,scheme,scheme.weights,'english_category',scheme.english_weights,translation).score,60);
for(const invalid of [-.1,1.1,NaN])assert.equal(totals(rows,scheme,scheme.weights,'english_category',{C:invalid},metadata).score,null);
const config=require('../app/eval_config.js').parseConfig(require('node:fs').readFileSync('configs/oellm.yaml','utf8'));
for(const english_weights of [{Code:-1},{Code:1.1},{Missing:.5},{Code:'0.5'}])assert.throws(()=>validateConfig({...config,english_weights}));
assert.throws(()=>validateConfig({...config,aggregate:'oops'}));
console.log('English-share arithmetic, coverage, translation, contribution reconciliation, filters, and validation passed.');
const data=require('../output/analysis.json');
for(const mode of ['standard','english_eval','english_category']){
 const actual=totals(data.rows.filter(r=>r.selected),data.scheme,data.scheme.weights,mode),expected=data.aggregates[mode][0];
 close(actual.score,expected.score);
 for(const c of actual.categories)close(c.score,expected.categories.find(x=>x.name===c.name).score);
 for(const e of actual.evals){const x=expected.evals.find(x=>x.name===e.name);close(e.weight,x.weight);close(e.contribution,x.contribution);}
}
// Exclude unavailable evals and renormalize the represented evals/categories.
const missingScheme={evals:[{name:'kept',category:'C'},{name:'absent',category:'C'},{name:'empty-category',category:'D'}],weights:{C:.6,D:.4}};
const kept={...rows[0],eval:'kept',category:'C',score_100:80,raw_score_100:80};
close(totals([kept],missingScheme,missingScheme.weights).score,80);
close(totals([kept],missingScheme,missingScheme.weights).categories.find(c=>c.name==='C').weight,1);
assert.equal(totals([kept],missingScheme,missingScheme.weights).categories.find(c=>c.name==='D').excluded,true);
assert.equal(totals([],missingScheme,missingScheme.weights).score,null);
const {comparisonCoverage}=require('../app/app.js');
const overlap=comparisonCoverage(rows,b.filter(r=>r.task!=='english'),scheme);
assert.equal(overlap.a.length,3);assert.equal(overlap.b.length,3);
assert.ok(overlap.warnings.some(w=>w.name==='english'));
const ca=totals(overlap.a,scheme,scheme.weights,'english_category',scheme.english_weights,metadata),cb=totals(overlap.b,scheme,scheme.weights,'english_category',scheme.english_weights,metadata);
close(ca.score,55); // One shared eval: .5*80 + .5*30.
close(comparisonRows(overlap.pairs,overlap.a,scheme,scheme.weights,'eval','weighted','descending','delta',metadata,'english_category').reduce((n,r)=>n+r.weightedDelta,0),ca.score-cb.score);
const partial=comparisonCoverage(rows,b.filter(r=>r.task!=='fr'),scheme);
assert.equal(partial.a.length,3);assert.equal(partial.b.length,3);assert.ok(partial.warnings.some(w=>w.name==='mixed'));
// Per-eval balancing preserves the equal eval weights: mixed=(80+30)/2=55; English-only=100.
const perEval=totals(rows,scheme,scheme.weights,'english_eval',scheme.english_weights,metadata);
close(perEval.score,77.5);
close(perEval.evals.find(e=>e.name==='mixed').weight,.5);
close(perEval.evals.find(e=>e.name==='english').weight,.5);
close(perEval.evals.find(e=>e.name==='mixed').englishScore,80);
close(perEval.evals.find(e=>e.name==='mixed').otherScore,30);
close(totals(rows,scheme,scheme.weights,'english_eval',{C:.8},metadata).score,85);
close(totals(rows,scheme,scheme.weights,'english_eval',{C:0},metadata).score,totals(rows,scheme,scheme.weights).score);
const perEvalB=totals(b,scheme,scheme.weights,'english_eval',scheme.english_weights,metadata);
for(const group of ['eval','category','variant'])close(comparisonRows(pairs,rows,scheme,scheme.weights,group,'weighted','descending','delta',metadata,'english_eval').reduce((sum,r)=>sum+r.weightedDelta,0),perEval.score-perEvalB.score);
close(comparisonRows(pairs.filter(r=>r.task==='fr'),rows,scheme,scheme.weights,'variant','weighted','descending','delta',metadata,'english_eval')[0].weightedDelta,.25);
close(totals(rows,scheme,scheme.weights,'english_eval',scheme.english_weights,translation).score,77.5);
close(totals(rows,scheme,scheme.weights,'english_eval',scheme.english_weights,pooled).score,72.5);
const perEvalOverlapA=totals(overlap.a,scheme,scheme.weights,'english_eval',scheme.english_weights,metadata),perEvalOverlapB=totals(overlap.b,scheme,scheme.weights,'english_eval',scheme.english_weights,metadata);
close(comparisonRows(overlap.pairs,overlap.a,scheme,scheme.weights,'eval','weighted','descending','delta',metadata,'english_eval').reduce((sum,r)=>sum+r.weightedDelta,0),perEvalOverlapA.score-perEvalOverlapB.score);
console.log('Per-eval and per-category balancing differ as specified; weights, filtering and deltas reconcile.');

// Missing assignments and mul fall back to English for weighting only; a known
// non-English pool (Croatian/Serbian) belongs to the other-language side.
for(const mode of ['english_eval','english_category']){
 for(const assignment of [null,{scope:'unknown',language:''},{scope:'pooled',language:'mul'},{scope:'translation',source_language:'fra_Latn',target_language:''}]){
  const fallback=new Map(metadata);if(assignment)fallback.set('fr',assignment);else fallback.delete('fr');
  const result=totals(rows,scheme,scheme.weights,mode,scheme.english_weights,fallback);
  close(result.score,mode==='english_eval'?72.5:57.5);
  close([...result.rowWeights.values()].reduce((a,b)=>a+b,0),1);
  const other=totals(b,scheme,scheme.weights,mode,scheme.english_weights,fallback);
  close(comparisonRows(pairs,rows,scheme,scheme.weights,'variant','weighted','descending','delta',fallback,mode).reduce((s,r)=>s+r.weightedDelta,0),result.score-other.score);
 }
 const knownPool=new Map(metadata);knownPool.set('fr',{scope:'pooled',language:'hbs_Latn'});
 close(totals(rows,scheme,scheme.weights,mode,scheme.english_weights,knownPool).score,mode==='english_eval'?77.5:60);
}
assert.equal(config.english_weights.Language,.5);
