import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {RequestLimiter} from '../server/rate-limit.ts';
test('pre-auth limiter bounds requests and memory and recovers at the next window',()=>{
 const limit=new RequestLimiter(2,1000,2);assert(limit.allow('a',0));assert(limit.allow('a',1));assert(!limit.allow('a',2));assert(limit.allow('b',2));assert(!limit.allow('c',3));assert(limit.allow('c',1001));assert(limit.allow('a',1002));
});
