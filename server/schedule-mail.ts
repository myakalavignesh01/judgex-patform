export function scheduleMessage(input:{origin:string;eventName:string;teamName:string;startsAt:string;timezone:string;room:string;kind:string}){
 const origin=new URL(input.origin);if(origin.protocol!=='https:')throw Error('Schedule links require HTTPS');const date=new Date(input.startsAt);if(!Number.isFinite(date.getTime()))throw Error('Invalid presentation time');
 const when=new Intl.DateTimeFormat('en',{dateStyle:'full',timeStyle:'long',timeZone:input.timezone}).format(date);
 return {subject:input.eventName+(input.kind==='presentation_reminder'?' — presentation reminder':' — presentation schedule'),text:input.teamName+' has a presentation scheduled for '+when+' in '+input.room+'.\nSign in for the latest schedule, check-in and recording alternatives: '+origin.origin+'/\nSchedules can change. The event workspace is the source of the current slot.'};
}
export async function sendScheduleEmail(config:{key:string;from:string;origin:string},message:{id:string;to:string;eventName:string;teamName:string;startsAt:string;timezone:string;room:string;kind:string}){
 if(!config.key||!config.from)throw Error('Email provider is not configured');const content=scheduleMessage({...message,origin:config.origin});
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json','Idempotency-Key':message.id},signal:AbortSignal.timeout(20000),body:JSON.stringify({from:config.from,to:[message.to],...content})});if(!r.ok)throw Error('Schedule email failed ('+r.status+')');return r.json();
}
