// Python builds share the browser's CSV/YAML parsers and schema validation.
const fs=require('node:fs');
const {parseConfig,parseCSV}=require('./eval_config.js');
try{process.stdout.write(JSON.stringify((process.argv[3]==='csv'?parseCSV:parseConfig)(fs.readFileSync(process.argv[2],'utf8'))));}
catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
