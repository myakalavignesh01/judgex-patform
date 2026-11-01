import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {encryptInvitation,decryptInvitation} from '../server/invitations.ts';
test('queued invitation tokens are authenticated encrypted',()=>{const key='a'.repeat(64),token='invitation-token';const value=encryptInvitation(token,key);assert(!value.includes(token));assert.equal(decryptInvitation(value,key),token);assert.throws(()=>decryptInvitation(value,'b'.repeat(64)));assert.notEqual(encryptInvitation(token,key),value);});
test('malformed encryption keys and ciphertext fail closed',()=>{assert.throws(()=>encryptInvitation('token','short'));assert.throws(()=>decryptInvitation('invalid','a'.repeat(64)));});
