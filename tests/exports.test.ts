import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {csvCell,resultsCsv} from '../src/platform/exports.ts';
test('exports neutralize spreadsheet formulas and distinguish unreleased human approvals',()=>{
 for(const v of ['=HYPERLINK("evil")','  +1','-1','@cmd','\tcontent'])assert(csvCell(v).startsWith('"\''));assert.equal(csvCell('A "quoted" title'),'"A ""quoted"" title"');
 const csv=resultsCsv({schemaVersion:1,eventId:'event',eventName:'Pilot',exportedAt:'2026-11-01',released:false,rows:[{team:'Team',approvedTotal:80,decisionVersion:2}]});assert(csv.includes('Unreleased human-approved draft'));assert(csv.includes('"decisionVersion"'));assert(!csv.includes('AI score'));
});
