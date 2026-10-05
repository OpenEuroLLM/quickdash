'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseViewHash,serializeViewHash}=require('../app/view_links.js');

test('view links round-trip settings, arbitrary labels and edited weights',()=>{
 const state={view:'comparisons',modelA:'A & B/# + 日本語',modelB:'Other',suite:'flagship-1.yaml',profile:'code-math.yaml',matching:'relaxed',aggregate:'english_eval',category:'Reading',eval:'Eval + special',language:'eng_Latn',direction:'from',search:'<& exact_match',scoreCategory:'Math',group:'eval',measure:'weighted',sort:'ascending',sortBy:'weightedDelta',languageSort:'delta',languageOrder:'descending',weights:{Math:.2,Reading:.8},englishWeights:{Math:0,Reading:.5},expandedComparisons:['Eval + special'],open:['eval:Eval + special','node:[["language","eng_Latn",""]]']};
 assert.deepEqual(parseViewHash(serializeViewHash(state)),state);
 assert.equal(serializeViewHash(state),serializeViewHash({...state}));
 assert.deepEqual(parseViewHash(''),{});
 assert.deepEqual(parseViewHash('#view=languages'),{view:'languages'});
 assert.deepEqual(parseViewHash('#view=score&local=1'),{view:'score',local:'1'});
});

test('invalid links are rejected before they can change a comparison',()=>{
 for(const hash of ['#v=2','#view=bad','#view=score&view=languages','#unknown=1','#weights=[]','#weights={"Code":-1}','#weights={"Code":null}','#englishWeights={"Code":2}','#open={}','#expandedComparisons=[1]','#matching=best','#sort=garbage','#local=0','#view=%FF','#weights={']){
  assert.throws(()=>parseViewHash(hash),undefined,hash);
 }
 assert.throws(()=>serializeViewHash({weights:{Code:NaN}}));
 assert.throws(()=>serializeViewHash({weights:{Code:Infinity}}));
});
