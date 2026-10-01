// Python builds share the browser's parsers, validation and set membership.
const fs=require('node:fs'),evals=require('./eval_config.js'),sets=require('./suite_config.js');
try{
 const source=fs.readFileSync(process.argv[2]==='-'?0:process.argv[2],'utf8'),mode=process.argv[3];
 const parsers={csv:evals.parseCSV,catalogue:evals.parseCatalogue,weights:sets.parseWeightProfile,suite:sets.parseSuite};
 const value=mode==='resolve'?sets.resolveConfig(...JSON.parse(source)):mode==='scope'?sets.scopeRows(...JSON.parse(source)):parsers[mode](source);
 process.stdout.write(JSON.stringify(value));
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
