'use strict';
const SuiteConfig=(()=>{
 const api=typeof module!=='undefined'?require('./eval_config.js'):EvalConfig;
 const yaml=typeof module!=='undefined'?require('./vendor/js-yaml.js'):jsyaml;
 const keys=(o,allowed,required=[])=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(o,k)))throw Error('Invalid config fields; allowed '+allowed.join(', '));};
 const text=v=>typeof v==='string'&&v.trim().length>0;
 function validateSuite(s){
  keys(s,['version','name','mode','evals','exclude','notes'],['version','name','mode']);
  if(s.version!==1||!text(s.name))throw Error('Suite requires version 1 and a name');
  if(!['available','fixed'].includes(s.mode))throw Error('Suite mode must be available or fixed');
  if('notes'in s&&(!Array.isArray(s.notes)||s.notes.some(n=>typeof n!=='string')))throw Error('Suite notes must be strings');
  if('exclude'in s&&(s.mode!=='available'||!Array.isArray(s.exclude)||s.exclude.some(n=>!text(n))||new Set(s.exclude).size!==s.exclude.length))throw Error('exclude must be a unique list of eval names in available mode');
  if(s.mode==='available'){if('evals'in s)throw Error('Available mode does not declare required evals');return s;}
  if(!Array.isArray(s.evals)||!s.evals.length)throw Error('Fixed suite needs required evals');
  const names=new Set();
  for(const e of s.evals){
   keys(e,['name','variants'],['name']);if(!text(e.name)||names.has(e.name))throw Error('Suite eval names must be unique');names.add(e.name);
   if(!('variants'in e))continue;
   if(!Array.isArray(e.variants)||!e.variants.length)throw Error('Required variants must be a nonempty list');
   const seen=new Map();
   for(const v of e.variants){
    keys(v,['task','n_shot'],['task']);if(!text(v.task))throw Error('Required variant needs a task name');
    if('n_shot'in v&&(!Number.isSafeInteger(v.n_shot)||v.n_shot<0))throw Error('Variant n_shot must be a nonnegative integer');
    const shots=seen.get(v.task)||new Set(),shot=v.n_shot??'*';
    if(shots.has(shot)||shots.has('*')||shot==='*'&&shots.size)throw Error('Duplicate or overlapping required variant: '+v.task);
    shots.add(shot);seen.set(v.task,shots);
   }
  }
  return s;
 }
 const parseSuite=source=>validateSuite(yaml.load(source,{schema:yaml.CORE_SCHEMA}));
 const serializeSuite=s=>yaml.dump(validateSuite(s),{schema:yaml.CORE_SCHEMA,lineWidth:110,noRefs:true});
 function validateWeightProfile(p){
  keys(p,['version','name','weights','english_weights','aggregate','notes'],['version','name','weights']);
  if(p.version!==1||!text(p.name))throw Error('Weight profile requires version 1 and a name');
  if('notes'in p&&(!Array.isArray(p.notes)||p.notes.some(n=>typeof n!=='string')))throw Error('Weight profile notes must be strings');
  api.validateWeights(p);return p;
 }
 const parseWeightProfile=source=>validateWeightProfile(yaml.load(source,{schema:yaml.CORE_SCHEMA}));
 const serializeWeightProfile=p=>yaml.dump(validateWeightProfile(p),{schema:yaml.CORE_SCHEMA,lineWidth:110,noRefs:true});
 function resolveConfig(catalogue,suite,profile){
  api.validateCatalogue(catalogue);validateSuite(suite);validateWeightProfile(profile);
  const evals=suite.mode==='available'?catalogue.evals:suite.evals.map(required=>{
   const e=catalogue.evals.find(e=>e.name===required.name);if(!e)throw Error('Suite eval has no catalogue rule: '+required.name);
   for(const v of required.variants||[]){
    const matches=catalogue.evals.filter(rule=>api.matchTask(rule.match,v.task));
    if(matches.length!==1||matches[0].name!==e.name||e.select&&!api.matchTask(e.select,v.task)||'shots'in e&&'n_shot'in v&&e.shots!==v.n_shot)throw Error('Required variant is not selected by its catalogue rule: '+v.task);
   }
   if(required.variants)api.validateAggregationSelection(e,required.variants,catalogue);
   return e;
  });
  return api.validateConfig({version:1,name:catalogue.name,evals,languages:catalogue.languages,weights:{...profile.weights,...Object.fromEntries(evals.filter(e=>!Object.hasOwn(profile.weights,e.category)).map(e=>[e.category,0]))},english_weights:{...profile.english_weights},aggregate:profile.aggregate||'standard',notes:[...(catalogue.notes||[]),...(profile.notes||[])]});
 }
 function inSuite(row,suite){
  if(suite.mode==='available')return !(suite.exclude||[]).includes(row.eval);
  const e=suite.evals.find(e=>e.name===row.eval);
  return !!e&&(!e.variants||e.variants.some(v=>v.task===row.task&&(!('n_shot'in v)||String(v.n_shot)===String(row.n_shot))));
 }
 function scopeRows(rows,suite){
  const selected=rows.filter(r=>r.selected),included=selected.filter(r=>inSuite(r,suite)),extras=selected.filter(r=>!inSuite(r,suite)),missing=[];
  if(suite.mode==='fixed')for(const e of suite.evals){
   if(e.variants)for(const v of e.variants){if(!included.some(r=>r.eval===e.name&&r.task===v.task&&(!('n_shot'in v)||String(v.n_shot)===String(r.n_shot))))missing.push({eval:e.name,task:v.task,n_shot:v.n_shot});}
   else if(!included.some(r=>r.eval===e.name))missing.push({eval:e.name});
  }
  return {rows:included,extras,missing};
 }
 function suiteCoverage(a,b,suite){
  const left=scopeRows(a,suite),right=scopeRows(b,suite),warnings=[];
  for(const [side,scope] of [['A',left],['B',right]]){
   for(const name of new Set(scope.missing.map(r=>r.eval))){const rr=scope.missing.filter(r=>r.eval===name);warnings.push({type:'Missing suite data',name,eval:name,model:side,detail:rr.length+' requirement(s) missing from '+suite.name+'. Missing results are excluded from both calculations. Comparison is incomplete; shared scores are used with redistributed weights.',variants:[{settings:'Required in '+side,tasks:rr.map(r=>r.task?(r.task+('n_shot'in r&&r.n_shot!==undefined?' · '+r.n_shot+' shots':'')):'Any selected measurement for '+r.eval)}]});}
  }
  const identity=r=>JSON.stringify(['task','metric','filter','n_shot','harness','backend'].map(k=>String(r[k]??'')));
  const rightKeys=new Set(right.rows.map(identity)),shared=scopeRows(left.rows.filter(r=>rightKeys.has(identity(r))),suite);
  const required=suite.mode==='fixed'?suite.evals.reduce((n,e)=>n+(e.variants?.length||1),0):null;
  return {a:left.rows,b:right.rows,warnings,complete:!shared.missing.length,required,sharedRequired:required===null?null:required-shared.missing.length,presentA:required===null?null:required-left.missing.length,presentB:required===null?null:required-right.missing.length,extrasA:left.extras.length,extrasB:right.extras.length};
 }
 return {validateWeightProfile,parseWeightProfile,serializeWeightProfile,validateSuite,parseSuite,serializeSuite,resolveConfig,inSuite,scopeRows,suiteCoverage};
})();
if(typeof module!=='undefined')module.exports=SuiteConfig;
