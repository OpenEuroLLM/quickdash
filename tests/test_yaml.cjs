const assert=require('node:assert/strict'),fs=require('node:fs');
const {parseConfig,serializeConfig}=require('../app/eval_config.js');
const config=parseConfig(fs.readFileSync('configs/oellm.yaml','utf8'));
assert.equal(config.evals.length,45);
assert.deepEqual(parseConfig(serializeConfig(config)),config);
const source=`# A four-choice example with quoted regex and a flow mapping
version: 1
name: Example
weights: {Reasoning: 1}
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
const example=parseConfig(source);
assert.equal(example.evals[0].normalize.min,.25);
assert.equal(example.evals[0].filter,'');
assert.equal(example.notes[0],'A folded explanation for people editing the config.');
for(const bad of [source+'version: 1\n',source+'---\nversion: 1',source.replace('min: 0.25','min: .nan'),source.replace('filter: \'\'','filter: [oops'),source.replace('name: Example\n','name: !!js/function function(){}\n')])assert.throws(()=>parseConfig(bad));
console.log('YAML checks passed: source config, round-trip, comments, quoted regex, flow syntax, multiline notes, invalid syntax and duplicate keys.');
