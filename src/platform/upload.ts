export type UploadProgress=(percentage:number)=>void;
export class EvidenceUploadError extends Error{
 artifact:Record<string,any>;stored:boolean;
 constructor(message:string,artifact:Record<string,any>,stored:boolean){super(message);this.name='EvidenceUploadError';this.artifact=artifact;this.stored=stored;}
}
export function uploadBinary(url:string,headers:Record<string,string>,file:Blob,progress?:UploadProgress):Promise<void>{
  return new Promise((resolve,reject)=>{const request=new XMLHttpRequest();request.open('POST',url);request.timeout=600000;for(const [key,value] of Object.entries(headers))request.setRequestHeader(key,value);request.upload.onprogress=e=>{if(e.lengthComputable&&e.total>0)progress?.(Math.min(100,Math.round(e.loaded/e.total*100)))};request.onload=()=>{if(request.status>=200&&request.status<300){progress?.(100);resolve()}else reject(Error('Storage upload failed ('+request.status+'). Your local recording is still available.'));};request.onerror=()=>reject(Error('Upload connection failed. Your local recording is still available.'));request.ontimeout=()=>reject(Error('Upload timed out. Your local recording is still available.'));request.onabort=()=>reject(Error('Upload was interrupted. Your local recording is still available.'));request.send(file);});
}
