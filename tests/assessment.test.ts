import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {validateAssessment} from '../server/assessment.ts';
const criteria=[{id:'build',name:'Build',weight:100}],evidence=[{id:'e1',text:'A working form',source:'slide 1'}];
const finding={criterionId:'build',score:8,rationale:'Supported prototype',evidenceIds:['e1'],uncertainty:'medium',limitations:[]};
test('assessment requires known citations and bounded scores',()=>{assert.equal(validateAssessment({findings:[finding],feedback:'Good',flags:[]},criteria,evidence).findings[0].score,8);assert.throws(()=>validateAssessment({findings:[{...finding,evidenceIds:['invented']}],feedback:'',flags:[]},criteria,evidence));assert.throws(()=>validateAssessment({findings:[{...finding,score:11}],feedback:'',flags:[]},criteria,evidence));});
test('missing evidence yields an explicit insufficient-evidence finding',()=>{assert.throws(()=>validateAssessment({findings:[{...finding,evidenceIds:[]}],feedback:'',flags:[]},criteria,evidence));const f={...finding,score:null,evidenceIds:[],limitations:['No technical evidence supplied']};assert.equal(validateAssessment({findings:[f],feedback:'',flags:[]},criteria,evidence).findings[0].score,null);});
test('duplicate and missing criteria fail validation',()=>{assert.throws(()=>validateAssessment({findings:[finding,finding],feedback:'',flags:[]},criteria,evidence));assert.throws(()=>validateAssessment({findings:[],feedback:'',flags:[]},criteria,evidence));});
