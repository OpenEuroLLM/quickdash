'use strict';
const EvalConfig=(()=>{
 const yaml=typeof module!=='undefined'?require('./vendor/js-yaml.js'):jsyaml;
 const canonical=/^(?:[a-z]{3}_[A-Z][a-z]{3}|mul)$(?![\s\S])/;
 const objectKeys=(value,allowed,required=[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('Invalid config fields; allowed '+allowed.join(', ')+'; required '+required.join(', '));};
 const number=v=>typeof v==='number'&&Number.isFinite(v);
 const decimal=/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
 const demoModel='SYNTHETIC demo — perturbed';
 const isDemoModel=name=>typeof name==='string'&&name.startsWith('SYNTHETIC demo — ');
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

 function portableRegex(pattern){
  let inside=false,quantifier=false;
  for(let i=0;i<pattern.length;i++){
   const c=pattern[i];
   if(c.charCodeAt(0)===92){
    const next=pattern[++i];
    if(!next||(!'dDwWsSnrt.^$*+?{}[]()|/-'.includes(next)&&next.charCodeAt(0)!==92)||next==='-'&&!inside)throw Error('Unsupported portable regex escape');
    if(inside&&['s','S'].includes(next))throw Error('Use an explicit whitespace class inside character classes');
    quantifier=false;continue;
   }
   if(c==='['){if(inside||pattern.slice(i,i+2)==='[]'||pattern.slice(i,i+3)==='[^]')throw Error('Invalid portable regex character class');inside=true;}
   else if(c===']'){if(!inside)throw Error('Unmatched portable regex bracket');inside=false;}
   else if(!inside){
    if(c==='('&&pattern[i+1]==='?'&&pattern[i+2]!==':')throw Error('Use portable regexes: no flags or lookarounds');
    if(c==='{'){const match=pattern.slice(i).match(/^\{[0-9]+(?:,[0-9]*)?\}/);if(!match)throw Error('Invalid portable regex quantifier');i+=match[0].length-1;quantifier=true;continue;}
    if(c==='}'||c==='+'&&quantifier)throw Error('Invalid portable regex quantifier');
   }
   quantifier=!inside&&'*+?'.includes(c);
  }
  return pattern;
 }
 function validateMatch(rule){objectKeys(rule,['name','regex']);const values=Object.values(rule);if(values.length!==1||typeof values[0]!=='string'||!values[0])throw Error('A match needs exactly one nonempty name or regex');if('regex'in rule){if(rule.regex.includes('(?P')||rule.regex.includes('(?<'))throw Error('Use portable regexes');new RegExp(portableRegex(rule.regex),'u');}}
 function matchTask(rule,task){return 'name'in rule?rule.name===task:new RegExp('^(?:'+portableRegex(rule.regex)+')$(?![\\s\\S])','u').test(task);}
 function validateWeights(config){
  const w=config.weights;objectKeys(w,Object.keys(w||{}));
  if(!Object.keys(w).length||Object.entries(w).some(([k,v])=>!k||!number(v)||v<0)||Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)>1e-8)throw Error('Category weights must be nonnegative and sum to 1');
  if('aggregate'in config&&!['standard','english_eval','english_category'].includes(config.aggregate))throw Error('Aggregate must be standard, english_eval, or english_category');
  if('english_weights'in config){objectKeys(config.english_weights,Object.keys(w));if(Object.values(config.english_weights).some(v=>!number(v)||v<0||v>1))throw Error('English weights must be between 0 and 1');}
 }
 function assembleCatalogue(metadata,definitions){
  objectKeys(metadata,['version','name','notes'],['version','name']);
  if(!Array.isArray(definitions)||!definitions.length)throw Error('At least one eval definition is required');
  const catalogue={...structuredClone(metadata),evals:[],languages:[]};
  for(const definition of definitions){
   if(!definition||typeof definition!=='object'||Array.isArray(definition)||!Object.hasOwn(definition,'languages'))throw Error('Each eval definition needs its own languages list');
   const {languages:groups,language_defaults:defaults={},...e}=structuredClone(definition);
   objectKeys(defaults,['evidence','note']);validateLanguageMetadata(defaults);
   if(!Array.isArray(groups))throw Error('languages must be a list');
   const languages=groups.map(group=>{
    if(!group||typeof group!=='object'||Array.isArray(group))return group;
    const g={...defaults,...group};
    if(!Object.hasOwn(g,'scope'))g.scope=Object.hasOwn(g,'source_language')||Object.hasOwn(g,'target_language')?'translation':g.language==='mul'?'pooled':'single';
    return g;
   });
   validateCatalogue({...metadata,evals:[e],languages});
   for(const group of languages)for(const task of group.tasks)if(!matchTask(e.match,task))throw Error(`Language task ${task} does not belong to eval ${e.name}`);
   catalogue.evals.push(e);catalogue.languages.push(...languages);
  }
  validateCatalogue(catalogue);
  for(const group of catalogue.languages)for(const task of group.tasks)if(catalogue.evals.filter(e=>matchTask(e.match,task)).length!==1)throw Error('Ambiguous eval config for task: '+task);
  return catalogue;
 }
 function validateCatalogue(config){
  objectKeys(config,['version','name','evals','languages','notes'],['version','name','evals','languages']);
  return validateRules(config);
 }
 // Resolved scoring configuration used by arithmetic helpers, never a YAML input format.
 function validateConfig(config){
  objectKeys(config,['version','name','weights','evals','languages','notes','aggregate','english_weights'],['version','name','weights','evals','languages']);
  validateWeights(config);validateRules(config);
  for(const e of config.evals)if(!Object.hasOwn(config.weights,e.category))throw Error('Eval category has no weight: '+e.category);
  return config;
 }
 function parseCatalogue(source){const config=yaml.load(source,{schema:yaml.CORE_SCHEMA});if(config&&Object.hasOwn(config,'evals_dir'))throw Error('This catalogue manifest needs files on disk. Build it first, then import the generated catalogue.yaml or export the complete catalogue from a dashboard.');return validateCatalogue(config);}
 function serializeCatalogue(config){return yaml.dump(validateCatalogue(config),{schema:yaml.CORE_SCHEMA,lineWidth:110,noRefs:true});}
 function validateRules(config){
  if(config.version!==1)throw Error('Unsupported config version');
  if(typeof config.name!=='string'||!config.name.trim())throw Error('Config name is required');
  if('notes'in config&&(!Array.isArray(config.notes)||config.notes.some(n=>typeof n!=='string')))throw Error('Notes must be strings');
  if(!Array.isArray(config.evals)||!config.evals.length)throw Error('At least one eval is required');
  const names=new Set();
  for(const e of config.evals){
   objectKeys(e,['name','category','match','metric','metric_filter','shots','select','score','normalize','warning','aggregation'],['name','category','match','metric','metric_filter','score']);
   if(typeof e.name!=='string'||!e.name||names.has(e.name))throw Error('Eval names must be unique and nonempty');names.add(e.name);
   if(typeof e.category!=='string'||!e.category.trim())throw Error('Eval category must be nonempty text');
   if(typeof e.metric!=='string'||!e.metric||typeof e.metric_filter!=='string')throw Error('Metric and filter must be strings');
   validateMatch(e.match);if('select'in e)validateMatch(e.select);
   if('shots'in e&&(!Number.isSafeInteger(e.shots)||e.shots<0))throw Error('shots must be a nonnegative integer');
   objectKeys(e.score,['scale'],['scale']);if(!number(e.score.scale)||e.score.scale<=0)throw Error('Score scale must be positive');
   if('warning'in e&&(typeof e.warning!=='string'||!e.warning.trim()))throw Error('Eval warning must be nonempty text');
   if('aggregation'in e){
    const a=e.aggregation;objectKeys(a,['components','note','sources'],['components']);
    if(!Array.isArray(a.components)||!a.components.length)throw Error('Aggregation needs components');
    const names=new Set();let total=0;
    for(const c of a.components){objectKeys(c,['name','match','relative_weight'],['name','match','relative_weight']);if(typeof c.name!=='string'||!c.name.trim()||names.has(c.name))throw Error('Component names must be unique and nonempty');names.add(c.name);validateMatch(c.match);if(!number(c.relative_weight)||c.relative_weight<=0)throw Error('Component weights must be positive finite numbers');total+=c.relative_weight;}
    if(!Number.isFinite(total))throw Error('Component weight sum must be finite');
    if('note'in a&&typeof a.note!=='string')throw Error('Aggregation note must be text');
    if('sources'in a&&(!Array.isArray(a.sources)||a.sources.some(u=>typeof u!=='string'||!/^https?:\/\//.test(u))))throw Error('Aggregation sources must be HTTP(S) URLs');
   }
   if('normalize'in e){const n=e.normalize;objectKeys(n,['min','max','clip','basis','note','sources'],['min','max']);if(!number(n.min)||!number(n.max)||!(0<=n.min&&n.min<n.max&&n.max<=1))throw Error('Normalization needs 0 <= min < max <= 1');if('clip'in n&&typeof n.clip!=='boolean')throw Error('Normalization clip must be boolean');if('basis'in n&&!['uniform_choice','uniform_integer','not_applicable','unresolved'].includes(n.basis))throw Error('Invalid normalization basis');if('note'in n&&typeof n.note!=='string')throw Error('Normalization note must be text');if('sources'in n&&(!Array.isArray(n.sources)||n.sources.some(u=>typeof u!=='string'||!/^https?:\/\//.test(u))))throw Error('Normalization sources must be HTTP(S) URLs');}
  }
  if(!Array.isArray(config.languages))throw Error('languages must be a list');const seen=new Set();
  for(const g of config.languages){
   objectKeys(g,['tasks','scope','language','source_language','target_language','evidence','note'],['tasks','scope']);
   if(!Array.isArray(g.tasks)||!g.tasks.length||g.tasks.some(t=>typeof t!=='string'||!t))throw Error('Language groups need exact task names');
   for(const task of g.tasks){if(seen.has(task))throw Error('Duplicate language assignment: '+task);seen.add(task);}
   if(!['single','pooled','translation'].includes(g.scope))throw Error('Invalid language scope');
   const fields=g.scope==='translation'?['source_language','target_language']:['language'],forbidden=g.scope==='translation'?['language']:['source_language','target_language'];
   if(forbidden.some(k=>k in g))throw Error('Use language for single/pooled; source and target for translation');
   for(const f of fields)if(typeof g[f]!=='string'||!canonical.test(g[f])||(g[f]==='mul'&&g.scope!=='pooled'))throw Error('Use canonical language codes, such as eng_Latn');
   validateLanguageMetadata(g);
  }
  return validateAggregationConfig(config);
 }
 function validateLanguageMetadata(g){
   for(const f of ['note','evidence'])if(f in g&&typeof g[f]!=='string')throw Error(f+' must be a string');
   if(g.evidence&&!/^https?:\/\//.test(g.evidence))throw Error('Evidence links must use HTTP or HTTPS');
 }
 // Validate concrete task selections without attempting to infer languages from regexes.
 function validateAggregationSelection(e,variants,config,unique=true){
  if(!e.aggregation)return;
  const metadata=new Map(config.languages.flatMap(g=>g.tasks.map(task=>[task,g]))),groups=new Map();
  const fail=detail=>{throw Error('Incompatible aggregation config for '+e.name+': '+detail);};
  for(const v of variants){
   const g=metadata.get(v.task);if(!g)fail(v.task+' needs an explicit language assignment');
   const language=g.scope==='translation'?g.source_language+' → '+g.target_language:g.language;
   const shot=v.n_shot??e.shots??'*',id=JSON.stringify([g.scope,language,shot]);
   if(!groups.has(id))groups.set(id,{label:language+' / shots '+shot,parts:new Map(e.aggregation.components.map(c=>[c.name,[]]))});
   const matches=e.aggregation.components.filter(c=>matchTask(c.match,v.task));
   if(matches.length!==1)fail(v.task+' matches '+matches.length+' components; expected exactly one');
   groups.get(id).parts.get(matches[0].name).push(v.task);
  }
  for(const group of groups.values())for(const [name,tasks] of group.parts){
   if(!tasks.length)fail(group.label+' is missing required component '+name+'; select every component with compatible shot settings');
   if(unique&&tasks.length>1)fail(group.label+' has multiple tasks for component '+name+': '+tasks.join(', '));
  }
 }
 function validateAggregationConfig(config){
  const knownTasks=config.languages.flatMap(g=>g.tasks);
  for(const e of config.evals.filter(e=>e.aggregation)){
   const eligible=task=>matchTask(e.match,task)&&(!e.select||matchTask(e.select,task));
   const tasks=new Set(knownTasks.filter(eligible));
   for(const c of e.aggregation.components)if('name'in c.match){
    if(!eligible(c.match.name))throw Error('Incompatible aggregation config for '+e.name+': component '+c.name+' task '+c.match.name+' is excluded by the eval match/selection rule');
    tasks.add(c.match.name);
   }
   for(const task of tasks)if(config.evals.filter(rule=>matchTask(rule.match,task)).length!==1)throw Error('Incompatible aggregation config for '+e.name+': '+task+' has ambiguous eval rules');
   validateAggregationSelection(e,[...tasks].map(task=>({task})),config,false);
  }
  return config;
 }
 function normalizeScore(value,e){if(!number(value)&&(typeof value!=='string'||!decimal.test(value.trim())))throw Error('Invalid score: expected a finite decimal number');const raw=Number(value)/e.score.scale;if(!Number.isFinite(raw)||raw<0||raw>1)throw Error('Invalid score: outside the configured source scale');const n=e.normalize??{min:0,max:1};let adjusted=(raw-n.min)/(n.max-n.min);if(n.clip!==false)adjusted=Math.max(0,Math.min(1,adjusted));if(!Number.isFinite(adjusted*100))throw Error('Invalid score: normalization overflow');return {raw_score_100:raw*100,score_100:adjusted*100};}
 function taskLanguage(task,config){const g=config.languages.find(g=>g.tasks.includes(task));return {task,language:g?.language??'',source_language:g?.source_language??'',target_language:g?.target_language??'',scope:g?.scope??'unknown',status:g?'resolved':'unknown',evidence:g?.evidence??'',provenance:g?(g.note??'Explicit language assignment in eval config.'):'No explicit language assignment for this task.'};}
 function auditRows(rows,config){
  (Object.hasOwn(config,'weights')?validateConfig:validateCatalogue)(config);const seen=new Set();return rows.map((source,index)=>{
   const r={...source};
   for(const field of ['checkpoint','task','metric','filter','n_shot','harness','backend','value'])if(!Object.hasOwn(r,field))throw Error('Missing CSV column: '+field);
   for(const field of ['checkpoint','task','metric','harness','backend'])if(typeof r[field]!=='string'||!r[field].trim())throw Error('CSV row '+(index+2)+': '+field+' must be nonempty text');
   if(isDemoModel(r.checkpoint))throw Error('Checkpoint name is reserved for the synthetic demo: '+r.checkpoint);
   if(typeof r.filter!=='string')throw Error('CSV row '+(index+2)+': filter must be text (blank is allowed)');
   if(!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(String(r.n_shot))||!Number.isSafeInteger(Number(r.n_shot)))throw Error('CSV row '+(index+2)+': n_shot must be a nonnegative integer');
   r.n_shot=String(r.n_shot);
   const matches=config.evals.filter(e=>matchTask(e.match,r.task));if(matches.length>1)throw Error('Ambiguous eval config for task: '+r.task);if(!matches.length)return {...r,eval:'',category:'',selected:false,decision:'No eval config; excluded from scoring',raw_score_100:null,score_100:null};const e=matches[0];let decision='Selected for the weighted score';
   if(e.select&&!matchTask(e.select,r.task))decision='Excluded summary level or alternate protocol; see eval selection rule';
   else if(r.metric!==e.metric)decision='Alternate metric; using '+e.metric;
   else if(r.filter!==e.metric_filter)decision='Alternate extraction filter; using '+(e.metric_filter||'(empty)');
   else if('shots'in e&&String(r.n_shot)!==String(e.shots))decision='Alternate shot setting; using '+e.shots+' shots';
   const selected=decision==='Selected for the weighted score';let scores={raw_score_100:null,score_100:null};
   if(selected){if(e.aggregation&&e.aggregation.components.filter(c=>matchTask(c.match,r.task)).length!==1)throw Error('Incompatible aggregation config for '+e.name+': '+r.task+' must match exactly one component');try{scores=normalizeScore(r.value,e);}catch(error){throw Error('CSV row '+(index+2)+' · '+r.checkpoint+' · '+r.task+' · '+r.metric+': '+error.message);}const key=JSON.stringify(['checkpoint','task','metric','filter','n_shot','harness','backend'].map(k=>r[k]));if(seen.has(key))throw Error('Duplicate selected measurement: '+r.checkpoint+' · '+r.task+' · '+r.metric);seen.add(key);}
   return {...r,eval:e.name,category:e.category,selected,decision,...scores};
  });
 }
function compareText(a,b){const aa=Array.from(a,c=>c.codePointAt(0)),bb=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;}
 return {compareText,assembleCatalogue,validateAggregationConfig,validateAggregationSelection,parseCatalogue,serializeCatalogue,validateCatalogue,validateWeights,parseCSV,validateConfig,matchTask,normalizeScore,taskLanguage,auditRows,demoModel,isDemoModel};
})();
if(typeof module!=='undefined')module.exports=EvalConfig;
