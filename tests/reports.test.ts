import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {reportDocument} from '../src/platform/reports.ts';
test('approved reports escape participant-controlled HTML',()=>{const html=reportDocument({eventName:'Event',projectTitle:'<script>alert(1)</script>',teamName:'<img src=x onerror=alert(1)>',total:80,feedback:'A & B',decisionVersion:1,approvedAt:'2026-11-01T00:00:00Z',scores:{build:8},criteria:[{id:'build',name:'Build',weight:100}]});assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(html.includes('&lt;script&gt;'));assert(html.includes('A &amp; B'));assert(html.includes('80.00'));});
