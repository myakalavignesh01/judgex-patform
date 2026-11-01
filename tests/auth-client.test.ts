import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {Client} from '../src/platform/client.ts';
function browser(t:any,hash=''){
 const values=new Map<string,string>(),original=new Map<string,PropertyDescriptor|undefined>();
 const location={hash,pathname:'/',search:'?invite=example',origin:'https://judgex.example'};let replaced='';
 const globals={location,sessionStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)},history:{replaceState:(_a:unknown,_b:unknown,url:string)=>{replaced=url;location.hash=''}}};
 for(const [key,value] of Object.entries(globals)){original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value,writable:true});}
 t.after(()=>{for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}});
 return {values,get replaced(){return replaced}};
}
const config={url:'https://test-project.supabase.co',key:'public-test-key',api:''};
test('recovery state survives reload while auth tokens are removed from the address bar',async t=>{
 const b=browser(t,'#access_token=synthetic-access&refresh_token=synthetic-refresh&expires_in=3600&type=recovery');const first=new Client(config);assert(first.recovery);assert.equal(b.replaced,'/?invite=example');assert(!b.replaced.includes('access_token'));
 const second=new Client(config);assert(second.recovery);let requests=0;second.request=async()=>{requests++;return {id:'verified-user'}};
 await assert.rejects(second.updatePassword('short'));assert.equal(requests,0);await second.updatePassword('synthetic-long-password');assert.equal(second.recovery,false);assert.equal(b.values.has('judgex.recovery'),false);
});
test('failed refresh clears the session once without recursive logout',async t=>{
 const b=browser(t);b.values.set('judgex.session',JSON.stringify({access_token:'expired',refresh_token:'invalid',expires_at:1}));b.values.set('judgex.recovery','true');const originalFetch=globalThis.fetch;t.after(()=>globalThis.fetch=originalFetch);let requests=0;globalThis.fetch=async()=>{requests++;return new Response('{}',{status:401})};
 const client=new Client(config);await assert.rejects(client.user(),/session expired/);assert.equal(requests,1);assert.equal(client.session,null);assert.equal(client.recovery,false);assert.equal(b.values.has('judgex.session'),false);
});
test('recovery links are requested for the current application origin',async t=>{
 browser(t);const client=new Client(config);let target='';client.request=async path=>{target=path;return {}};await client.recover('owner@example.test');assert.equal(new URL('https://test-project.supabase.co'+target).searchParams.get('redirect_to'),'https://judgex.example/');
});
