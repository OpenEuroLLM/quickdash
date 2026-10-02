// One process accepts a batch so differential tests don't pay startup per case.
const E=require('../app/eval_config.js'),S=require('../app/suite_config.js'),A=require('../app/analysis.js');
const fs=require('node:fs');
function run(c){try{
 const config=c.yaml?{catalogue:E.parseCatalogue(c.yaml.catalogue),profile:S.parseWeightProfile(c.yaml.profile),suite:S.parseSuite(c.yaml.suite)}:c.config;
 if(Object.hasOwn(c,'eval_definitions'))config.catalogue=E.assembleCatalogue(config.catalogue,c.eval_definitions);
 const rows=c.csv!==undefined?E.parseCSV(c.csv):c.rows;
 return {value:c.operation==='compare'?A.compare(rows,config,c.a||'A',c.b||'B'):A.analyze(rows,config)};
}catch(error){return {error:true,message:error.message};}}
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(run)));
