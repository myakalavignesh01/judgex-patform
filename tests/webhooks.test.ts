import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {Webhook} from 'svix';
import {verifyEmailWebhook} from '../server/webhooks.ts';
test('email webhook requires a signed, current, unmodified body',()=>{const secret='whsec_'+Buffer.alloc(32,7).toString('base64'),wh=new Webhook(secret),date=new Date(),id='message-1',raw=JSON.stringify({type:'email.delivered',data:{email_id:'email-1'}}),headers={'svix-id':id,'svix-timestamp':String(Math.floor(date.getTime()/1000)),'svix-signature':wh.sign(id,date,raw)};assert.equal(verifyEmailWebhook(raw,headers,secret).data.email_id,'email-1');assert.throws(()=>verifyEmailWebhook(raw.replace('email-1','email-2'),headers,secret));assert.throws(()=>verifyEmailWebhook(raw,{...headers,'svix-id':'message-2'},secret));const old=new Date(Date.now()-3600000);assert.throws(()=>verifyEmailWebhook(raw,{...headers,'svix-timestamp':String(Math.floor(old.getTime()/1000)),'svix-signature':wh.sign(id,old,raw)},secret));});
