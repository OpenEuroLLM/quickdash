const assert=require('node:assert/strict'),fs=require('node:fs');
const {parseCatalogue,serializeCatalogue,normalizeScore,auditRows}=require('../app/eval_config.js');
const config=require('../app/catalogue_io.cjs').loadCatalogue('configs/catalogue.yaml');
assert.deepEqual(parseCatalogue(serializeCatalogue(config)),config);
const {diagnosticsFor}=require('./diagnostic_fixture.cjs');
assert.deepEqual(diagnosticsFor(new Map(),config),[]);
const source=`# A four-choice example with quoted regex and a flow mapping
version: 1
name: Example
evals:
  - name: Example eval
    category: Reasoning
    match: {regex: 'example_(en|fr)'}
    metric: acc_norm
    metric_filter: ''
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
assert.equal(example.evals[0].metric_filter,'');
assert.equal(example.notes[0],'A folded explanation for people editing the config.');
for(const bad of [source+'version: 1\n',source+'---\nversion: 1',source.replace('min: 0.25','min: .nan'),source.replace('metric_filter: \'\'','metric_filter: [oops'),source.replace('name: Example\n','name: !!js/function function(){}\n')])assert.throws(()=>parseCatalogue(bad));
console.log('YAML checks passed: source config, round-trip, comments, quoted regex, flow syntax, multiline notes, invalid syntax and duplicate keys.');
