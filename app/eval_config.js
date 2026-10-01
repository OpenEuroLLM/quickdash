'use strict';
const EvalConfig=(()=>{
 const yaml=typeof module!=='undefined'?require('./vendor/js-yaml.js'):jsyaml;
 function parseConfig(source){return validateConfig(yaml.load(source,{schema:yaml.CORE_SCHEMA}));}
 function serializeConfig(config){return yaml.dump(validateConfig(config),{schema:yaml.CORE_SCHEMA,lineWidth:110,noRefs:true,sortKeys:false});}
 const canonical=/^(?:[a-z]{3}_[A-Z][a-z]{3}|mul)$/;
 const objectKeys=(value,allowed,required=[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('Invalid config fields; allowed '+allowed.join(', ')+'; required '+required.join(', '));};
 const number=v=>typeof v==='number'&&Number.isFinite(v);
 const decimal=/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
 const demoModel='SYNTHETIC demo — perturbed';
 function parseCSV(source){
  const text=source.replace(/^\uFEFF/,''),records=[];let row=[],value='',state='start',touched=false;
  const field=()=>{row.push(value);value='';state='start';};
  const record=()=>{if(touched||row.length||value){field();records.push(row);}row=[];touched=false;};
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(state==='quoted'){
    if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else state='closed';}else value+=c;
    continue;
   }
   if(c===','){field();touched=true;}
   else if(c==='\r'||c==='\n'){record();if(c==='\r'&&text[i+1]==='\n')i++;}
   else if(c==='"'&&state==='start'){state='quoted';touched=true;}
   else if(c==='"'||state==='closed')throw Error('Malformed CSV quote in record '+(records.length+1));
   else{state='plain';value+=c;touched=true;}
  }
  if(state==='quoted')throw Error('Unclosed quoted field in CSV record '+(records.length+1));
  record();
  if(!records.length)throw Error('Empty CSV');
  const header=records.shift();
  if(header.some(h=>!h.trim())||new Set(header).size!==header.length)throw Error('CSV headers must be nonempty and unique');
  if(!records.length)throw Error('No measurements in CSV');
  return records.map((r,i)=>{
   if(r.length!==header.length)throw Error('CSV row '+(i+2)+' width mismatch: expected '+header.length+' fields, found '+r.length);
   if(r.every(v=>!v.trim()))throw Error('Empty CSV row '+(i+2));
   return Object.fromEntries(header.map((h,j)=>[h,r[j]]));
  });
 }
 function validateMatch(rule){objectKeys(rule,['name','regex']);const values=Object.values(rule);if(values.length!==1||typeof values[0]!=='string'||!values[0])throw Error('A match needs exactly one nonempty name or regex');if('regex'in rule){if(rule.regex.includes('(?P')||rule.regex.includes('(?<'))throw Error('Use portable regexes');new RegExp(rule.regex);}}
 function matchTask(rule,task){return 'name'in rule?rule.name===task:new RegExp('^(?:'+rule.regex+')$(?![\\s\\S])').test(task);}
 function validateConfig(config){
  objectKeys(config,['version','name','weights','evals','languages','notes','aggregate','english_weights'],['version','name','weights','evals','languages']);
  if(config.version!==1)throw Error('Unsupported config version');
  if(typeof config.name!=='string'||!config.name)throw Error('Config name is required');
  const w=config.weights;objectKeys(w,Object.keys(w||{}));
  if(!Object.keys(w).length||Object.entries(w).some(([k,v])=>!k||!number(v)||v<0)||Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)>1e-8)throw Error('Category weights must be nonnegative and sum to 1');
  if('aggregate'in config&&!['standard','english_eval','english_category'].includes(config.aggregate))throw Error('Aggregate must be standard, english_eval, or english_category');
  if('english_weights'in config){objectKeys(config.english_weights,Object.keys(w));if(Object.values(config.english_weights).some(v=>!number(v)||v<0||v>1))throw Error('English weights must be between 0 and 1');}
  if('notes'in config&&(!Array.isArray(config.notes)||config.notes.some(n=>typeof n!=='string')))throw Error('Notes must be strings');
  if(!Array.isArray(config.evals)||!config.evals.length)throw Error('At least one eval is required');
  const names=new Set(),categories=new Set();
  for(const e of config.evals){
   objectKeys(e,['name','category','match','metric','filter','shots','select','score','normalize','warning'],['name','category','match','metric','filter','score']);
   if(typeof e.name!=='string'||!e.name||names.has(e.name))throw Error('Eval names must be unique and nonempty');names.add(e.name);categories.add(e.category);
   if(typeof e.category!=='string'||!Object.hasOwn(w,e.category))throw Error('Eval category has no weight: '+e.category);
   if(typeof e.metric!=='string'||!e.metric||typeof e.filter!=='string')throw Error('Metric and filter must be strings');
   validateMatch(e.match);if('select'in e)validateMatch(e.select);
   if('shots'in e&&(!Number.isInteger(e.shots)||e.shots<0))throw Error('shots must be a nonnegative integer');
   objectKeys(e.score,['scale'],['scale']);if(!number(e.score.scale)||e.score.scale<=0)throw Error('Score scale must be positive');
   if('warning'in e&&(typeof e.warning!=='string'||!e.warning.trim()))throw Error('Eval warning must be nonempty text');
   if('normalize'in e){const n=e.normalize;objectKeys(n,['min','max','clip','basis','note','sources'],['min','max']);if(!number(n.min)||!number(n.max)||!(0<=n.min&&n.min<n.max&&n.max<=1))throw Error('Normalization needs 0 <= min < max <= 1');if('clip'in n&&typeof n.clip!=='boolean')throw Error('Normalization clip must be boolean');if('basis'in n&&!['uniform_choice','uniform_integer','not_applicable','unresolved'].includes(n.basis))throw Error('Invalid normalization basis');if('note'in n&&typeof n.note!=='string')throw Error('Normalization note must be text');if('sources'in n&&(!Array.isArray(n.sources)||n.sources.some(u=>typeof u!=='string'||!/^https?:\/\//.test(u))))throw Error('Normalization sources must be HTTP(S) URLs');}
  }
  if(categories.size!==Object.keys(w).length)throw Error('Each weighted category needs at least one eval');
  if(!Array.isArray(config.languages))throw Error('languages must be a list');const seen=new Set();
  for(const g of config.languages){
   objectKeys(g,['tasks','scope','language','source_language','target_language','evidence','note'],['tasks','scope']);
   if(!Array.isArray(g.tasks)||!g.tasks.length||g.tasks.some(t=>typeof t!=='string'||!t))throw Error('Language groups need exact task names');
   for(const task of g.tasks){if(seen.has(task))throw Error('Duplicate language assignment: '+task);seen.add(task);}
   if(!['single','pooled','translation'].includes(g.scope))throw Error('Invalid language scope');
   const fields=g.scope==='translation'?['source_language','target_language']:['language'],forbidden=g.scope==='translation'?['language']:['source_language','target_language'];
   if(forbidden.some(k=>k in g))throw Error('Use language for single/pooled; source and target for translation');
   for(const f of fields)if(typeof g[f]!=='string'||!canonical.test(g[f])||(g[f]==='mul'&&g.scope!=='pooled'))throw Error('Use canonical language codes, such as eng_Latn');
   for(const f of ['note','evidence'])if(f in g&&typeof g[f]!=='string')throw Error(f+' must be a string');
   if(g.evidence&&!/^https?:\/\//.test(g.evidence))throw Error('Evidence links must use HTTP or HTTPS');
  }
  return config;
 }
 function normalizeScore(value,e){if(!number(value)&&(typeof value!=='string'||!decimal.test(value.trim())))throw Error('Invalid score: expected a finite decimal number');const raw=Number(value)/e.score.scale;if(!Number.isFinite(raw)||raw<0||raw>1)throw Error('Invalid score: outside the configured source scale');const n=e.normalize??{min:0,max:1};let adjusted=(raw-n.min)/(n.max-n.min);if(n.clip!==false)adjusted=Math.max(0,Math.min(1,adjusted));if(!Number.isFinite(adjusted*100))throw Error('Invalid score: normalization overflow');return {raw_score_100:raw*100,score_100:adjusted*100};}
 function taskLanguage(task,config){const g=config.languages.find(g=>g.tasks.includes(task));return {task,language:g?.language??'',source_language:g?.source_language??'',target_language:g?.target_language??'',scope:g?.scope??'unknown',status:g?'resolved':'unknown',evidence:g?.evidence??'',provenance:g?(g.note??'Explicit language assignment in eval config.'):'No explicit language assignment for this task.'};}
 function auditRows(rows,config){
  validateConfig(config);const seen=new Set();return rows.map((source,index)=>{
   const r={...source};
   for(const field of ['checkpoint','task','metric','filter','n_shot','harness','backend','value'])if(!Object.hasOwn(r,field))throw Error('Missing CSV column: '+field);
   for(const field of ['checkpoint','task','metric','harness','backend'])if(typeof r[field]!=='string'||!r[field].trim())throw Error('CSV row '+(index+2)+': '+field+' must be nonempty text');
   if(r.checkpoint===demoModel)throw Error('Checkpoint name is reserved for the synthetic demo: '+demoModel);
   if(typeof r.filter!=='string')throw Error('CSV row '+(index+2)+': filter must be text (blank is allowed)');
   if(!/^(?:0|[1-9][0-9]*)$/.test(String(r.n_shot))||!Number.isSafeInteger(Number(r.n_shot)))throw Error('CSV row '+(index+2)+': n_shot must be a nonnegative integer');
   r.n_shot=String(r.n_shot);
   const matches=config.evals.filter(e=>matchTask(e.match,r.task));if(matches.length>1)throw Error('Ambiguous eval config for task: '+r.task);if(!matches.length)return {...r,eval:'',category:'',selected:false,decision:'No eval config; excluded from scoring',raw_score_100:null,score_100:null};const e=matches[0];let decision='Selected for the weighted score';
   if(e.select&&!matchTask(e.select,r.task))decision='Excluded summary level or alternate protocol; see eval selection rule';
   else if(r.metric!==e.metric)decision='Alternate metric; using '+e.metric;
   else if(r.filter!==e.filter)decision='Alternate extraction filter; using '+(e.filter||'(empty)');
   else if('shots'in e&&String(r.n_shot)!==String(e.shots))decision='Alternate shot setting; using '+e.shots+' shots';
   const selected=decision==='Selected for the weighted score';let scores={raw_score_100:null,score_100:null};
   if(selected){try{scores=normalizeScore(r.value,e);}catch(error){throw Error('CSV row '+(index+2)+' · '+r.checkpoint+' · '+r.task+' · '+r.metric+': '+error.message);}const key=JSON.stringify(['checkpoint','task','metric','filter','n_shot','harness','backend'].map(k=>r[k]));if(seen.has(key))throw Error('Duplicate selected measurement: '+r.checkpoint+' · '+r.task+' · '+r.metric);seen.add(key);}
   return {...r,eval:e.name,category:e.category,selected,decision,...scores};
  });
 }
 return {parseCSV,parseConfig,serializeConfig,validateConfig,matchTask,normalizeScore,taskLanguage,auditRows,demoModel};
})();
if(typeof module!=='undefined')module.exports=EvalConfig;
