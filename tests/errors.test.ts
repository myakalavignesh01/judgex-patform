import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {requestError} from '../src/platform/errors.ts';
test('auth failures distinguish verification, credentials and rate limits',()=>{assert.match(requestError({error_code:'email_not_confirmed',msg:'Email not confirmed'},400),/Verify your email/);assert.match(requestError({code:'invalid_credentials'},400),/email or password/);assert.match(requestError({},429),/Wait a few minutes/);});
test('GoTrue msg responses remain visible instead of a generic HTTP error',()=>{assert.equal(requestError({msg:'Signup is disabled'},400),'Signup is disabled');assert.match(requestError(null,503),/503/);});
