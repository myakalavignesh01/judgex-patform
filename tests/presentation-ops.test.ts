import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {scheduleMessage} from '../server/schedule-mail.ts';
import {compareApproved} from '../src/platform/tie-break.ts';
test('schedule emails use the event timezone and secure current-workspace link',()=>{
 const message=scheduleMessage({origin:'https://judgex.example/path',eventName:'Pilot',teamName:'Team A',startsAt:'2026-11-01T09:00:00Z',timezone:'Asia/Kolkata',room:'Room A',kind:'presentation_reminder'});assert(message.subject.includes('reminder'));assert(message.text.includes('14:30')||message.text.includes('2:30'));assert(message.text.includes('https://judgex.example/'));assert(!message.text.includes('/path'));assert.throws(()=>scheduleMessage({origin:'http://example.test',eventName:'Pilot',teamName:'A',startsAt:'invalid',timezone:'UTC',room:'A',kind:'schedule'}));
});
test('tie-breaks follow published priority without changing weighted totals',()=>{
 const criteria=[{id:'build',tie_break_priority:2},{id:'impact',tie_break_priority:1}];const a={weighted_total:80,scores:{build:9,impact:7}},b={weighted_total:80,scores:{build:7,impact:9}};assert(compareApproved(a,b,criteria)>0);assert(compareApproved(a,b,[{id:'build',tie_break_priority:1}])<0);assert.equal(compareApproved(a,b,[]),0);assert(compareApproved({...a,weighted_total:81},b,criteria)<0);assert.equal(a.weighted_total,80);
});
