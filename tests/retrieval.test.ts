import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {chunkText} from '../server/retrieval.ts';
test('source chunks preserve overlap and cover the complete text',()=>{const text='0123456789'.repeat(100);const chunks=chunkText(text,200,40);assert.equal(chunks[0].length,200);assert.equal(chunks[0].slice(-40),chunks[1].slice(0,40));assert.equal(chunks.at(-1)?.slice(-40),text.slice(-40));assert.deepEqual(chunkText(''),[]);assert.throws(()=>chunkText(text,100,100));});
