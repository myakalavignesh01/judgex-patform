/** Pre-authentication guard for a single API process. Distributed user limits live in PostgreSQL. */
export class RequestLimiter{
 private windows=new Map<string,{start:number;count:number}>();
 private maximum:number;private windowMs:number;private capacity:number;
 constructor(maximum=1000,windowMs=60000,capacity=10000){this.maximum=maximum;this.windowMs=windowMs;this.capacity=capacity;}
 allow(key:string,now=Date.now()){
  let entry=this.windows.get(key);if(!entry||now-entry.start>=this.windowMs){
   if(!entry&&this.windows.size>=this.capacity){for(const [k,v] of this.windows)if(now-v.start>=this.windowMs)this.windows.delete(k);if(this.windows.size>=this.capacity)return false;}
   entry={start:now,count:0};this.windows.set(key,entry);
  }entry.count++;return entry.count<=this.maximum;
 }
}
