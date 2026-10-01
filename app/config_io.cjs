// Python builds share the browser's parsers, validation and set membership.
const fs=require('node:fs'),evals=require('./eval_config.js'),sets=require('./suite_config.js');
try{
 const source=fs.readFileSync(process.argv[2]==='-'?0:process.argv[2],'utf8'),mode=process.argv[3];
 const parsers={csv:evals.parseCSV,catalogue:evals.parseCatalogue,weights:sets.parseWeightProfile,suite:sets.parseSuite};
 const summarize=([audit,config,aggregate])=>{
  const app=require('./app.js');
  return [...new Set(audit.map(r=>r.checkpoint))].sort().map(model=>{
   const selected=audit.filter(r=>r.checkpoint===model&&r.selected),coverage=app.componentCoverage(selected,config),t=app.totals(selected,config,config.weights,aggregate);
   return {model,score:t.score,warnings:coverage.warnings,evals:t.evals.map(e=>Object.fromEntries(['name','category','metric','score','weight','contribution','aggregateScore','excluded','englishShare','effectiveEnglishShare','englishScore','otherScore','issue'].map(k=>[k,e[k]]).concat([['count',e.rows.length]]))),categories:t.categories.map(c=>({...c,evals:t.evals.filter(e=>e.category===c.name&&!e.excluded).length}))};
  });
 };
 const value=mode==='summarize'?summarize(JSON.parse(source)):mode==='resolve'?sets.resolveConfig(...JSON.parse(source)):mode==='scope'?sets.scopeRows(...JSON.parse(source)):parsers[mode](source);
 process.stdout.write(JSON.stringify(value));
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
