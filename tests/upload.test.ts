import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {uploadBinary} from '../src/platform/upload.ts';
test('upload progress finishes only after a successful storage response and failures reject',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'XMLHttpRequest');let request:any;class Request{status=200;upload:any={};onload:any;onerror:any;ontimeout:any;onabort:any;timeout=0;headers:any={};constructor(){request=this;}open(method:string,url:string){assert.equal(method,'POST');assert.equal(url,'https://storage.example/object');}setRequestHeader(k:string,v:string){this.headers[k]=v;}send(){}}
 Object.defineProperty(globalThis,'XMLHttpRequest',{value:Request,configurable:true,writable:true});t.after(()=>{if(original)Object.defineProperty(globalThis,'XMLHttpRequest',original);else Reflect.deleteProperty(globalThis,'XMLHttpRequest')});
 const progress:number[]=[];const upload=uploadBinary('https://storage.example/object',{Authorization:'Bearer synthetic'},new Blob(['source']),p=>progress.push(p));request.upload.onprogress({lengthComputable:true,loaded:5,total:10});assert.deepEqual(progress,[50]);request.onload();await upload;assert.deepEqual(progress,[50,100]);
 for(const failure of ['onerror','ontimeout','onabort']){const failed=uploadBinary('https://storage.example/object',{},new Blob(['source']));request[failure]();await assert.rejects(failed,/local recording is still available/);}
 const failed=uploadBinary('https://storage.example/object',{},new Blob(['source']));request.status=403;request.onload();await assert.rejects(failed,/403/);
});
