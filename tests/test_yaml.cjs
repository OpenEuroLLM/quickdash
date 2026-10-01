const assert=require('node:assert/strict'),fs=require('node:fs');
const {parseCatalogue,serializeCatalogue,normalizeScore,auditRows}=require('../app/eval_config.js');
const config=parseCatalogue(fs.readFileSync('configs/catalogue.yaml','utf8'));
assert.equal(config.evals.length,46);
assert.deepEqual(parseCatalogue(serializeCatalogue(config)),config);
// The published OELLM config selects reliable SIB-200 accuracy and the paper's
// approximate JEEBench baseline; neither is an unresolved config caveat.
const sib=config.evals.find(e=>e.name==='SIB-200'),jee=config.evals.find(e=>e.name==='JEEBench');
assert.equal(sib.metric,'acc');assert.equal(sib.warning,undefined);
assert.equal(jee.normalize.min,.1055);assert.equal(jee.normalize.max,1);
assert.equal(jee.normalize.clip,true);assert.notEqual(jee.normalize.basis,'unresolved');
assert.equal(jee.warning,undefined);
for(const [value,expected] of [[0,0],[.105,0],[.1055,0],[.55275,50],[1,100]]){
 const score=normalizeScore(value,jee);
 assert.ok(Math.abs(score.score_100-expected)<1e-10);
 assert.ok(Math.abs(score.raw_score_100-value*100)<1e-10);
}
const sibRows=auditRows(['acc','acc_norm'].map(metric=>({checkpoint:'Fixture',task:'sib200_eng_Latn',metric,filter:'none',n_shot:'0',harness:'test',backend:'cpu',value:'.5'})),config);
assert.deepEqual(sibRows.filter(r=>r.selected).map(r=>r.metric),['acc']);
const {collectWarnings}=require('../app/app.js');
assert.deepEqual(collectWarnings(new Map(),config),[]);
assert.deepEqual(config.evals.filter(e=>e.warning).map(e=>e.name).sort(),['Global PIQA (prompted)','MultiBlimp']);
const source=`# A four-choice example with quoted regex and a flow mapping
version: 1
name: Example
evals:
  - name: Example eval
    category: Reasoning
    match: {regex: 'example_(en|fr)'}
    metric: acc_norm
    filter: ''
    shots: 0
    score: {scale: 1}
    normalize: {min: 0.25, max: 1, clip: true}
languages:
  - tasks: [example_en]
    scope: single
    language: eng_Latn
notes:
  - >-
    A folded explanation
    for people editing the config.
`;
const example=parseCatalogue(source);
assert.equal(example.evals[0].normalize.min,.25);
assert.equal(example.evals[0].filter,'');
assert.equal(example.notes[0],'A folded explanation for people editing the config.');
for(const bad of [source+'version: 1\n',source+'---\nversion: 1',source.replace('min: 0.25','min: .nan'),source.replace('filter: \'\'','filter: [oops'),source.replace('name: Example\n','name: !!js/function function(){}\n')])assert.throws(()=>parseCatalogue(bad));
console.log('YAML checks passed: source config, round-trip, comments, quoted regex, flow syntax, multiline notes, invalid syntax and duplicate keys.');

assert.equal(config.evals.find(e=>e.name==='AMC23').normalize.min,0);
assert.equal(config.evals.find(e=>e.name==='ARC Easy').normalize.min,.25);
assert.equal(config.evals.find(e=>e.name==='FLORES200').metric,'chrf++');
assert.equal(config.evals.find(e=>e.name==='OpenSubtitles').metric,'chrf');
for(const e of config.evals.filter(e=>e.category==='Translation')){assert.equal(e.warning,undefined);assert.equal(e.normalize.min,0);assert.equal(e.score.scale,100);}
const {parseSuite,inSuite}=require('../app/suite_config.js');
const freeform=parseSuite(fs.readFileSync('configs/sets/any-available.yaml','utf8'));
const prompted=config.evals.find(e=>e.name==='Global PIQA (prompted)');
assert.match(prompted.warning,/Normalization and metric selection have not been validated/);
assert.equal(inSuite({eval:prompted.name},freeform),false);
