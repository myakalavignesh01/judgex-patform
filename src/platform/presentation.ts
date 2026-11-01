export type RecordingState='idle'|'ready'|'checking'|'recording'|'stopped'|'failed';
export type CaptureSource='camera'|'microphone'|'screen';
export type CaptureConsent={accepted:boolean;policyVersion:string};
export type RecordedClip={source:'camera'|'screen'|'audio';blob:Blob;startedAt:string;durationSeconds:number;sessionId:string};
type Part={source:RecordedClip['source'];recorder:MediaRecorder;chunks:Blob[];done:boolean;started:boolean};
/** All permission requests originate from explicit device buttons after informed consent. */
export class PresentationCapture{
 state:RecordingState='idle';startedAt:number|null=null;sessionId='';clips:RecordedClip[]=[];notice='';
 private sources:Partial<Record<CaptureSource,MediaStream>>={};private parts:Part[]=[];private bytes=0;private pending=new Set<CaptureSource>();
 private notify:()=>void=()=>{};private disposed=false;private generation=0;private stopping=false;private failed=false;private finalized=false;
 private deadline:ReturnType<typeof setTimeout>|null=null;private completion:Promise<RecordedClip[]>|null=null;private resolve:((clips:RecordedClip[])=>void)|null=null;
 private maximumBytes:number;private durationMs:number;
 constructor(limits={maximumBytes:90*1024*1024,durationMs:890000}){this.maximumBytes=limits.maximumBytes;this.durationMs=limits.durationMs;}
 subscribe(listener:()=>void){this.notify=listener;return()=>{this.notify=()=>{}};}
 get cameraStream(){return this.sources.camera||null;}get screenStream(){return this.sources.screen||null;}
 get sourceState(){return {camera:this.live('camera'),microphone:this.live('microphone'),screen:this.live('screen')};}
 private live(source:CaptureSource){return !!this.sources[source]?.getTracks().some(t=>t.readyState==='live');}
 private requireConsent(consent:CaptureConsent){if(!consent.accepted||!consent.policyVersion)throw Error('Accept the recording policy before enabling devices');if(this.disposed)throw Error('Presentation capture has closed');}
 async setSource(source:CaptureSource,enabled:boolean,consent:CaptureConsent){
  this.requireConsent(consent);if(['recording','checking'].includes(this.state))throw Error('Stop recording before changing capture sources');
  if(!enabled){const stream=this.sources[source];delete this.sources[source];stream?.getTracks().forEach(t=>t.stop());this.state=Object.values(this.sourceState).some(Boolean)?'ready':'idle';this.notify();return;}
  if(this.live(source))return;if(this.pending.has(source))throw Error('A permission request for this device is already open');
  const devices=navigator.mediaDevices;if(!devices)throw Error('Media capture is unavailable in this browser');if(source==='screen'&&typeof devices.getDisplayMedia!=='function')throw Error('Screen sharing is unavailable in this browser. Use camera/microphone or permitted uploaded evidence.');const generation=this.generation;
  // Each request is independent: a denied device never disposes another working source.
  let stream:MediaStream;
  this.pending.add(source);try{stream=source==='screen'?await devices.getDisplayMedia({video:true,audio:false}):await devices.getUserMedia({video:source==='camera',audio:source==='microphone'});}catch(e){this.notice=source+' access was not enabled. Your other sources are unchanged.';this.notify();throw e;}finally{this.pending.delete(source);}
  if(this.disposed||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw Error('Capture closed while permission was pending');}
  if(!stream.getTracks().some(t=>t.readyState==='live')){stream.getTracks().forEach(t=>t.stop());throw Error('No active '+source+' track was supplied');}
  this.sources[source]=stream;this.notice='';
  for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(this.sources[source]!==stream)return;delete this.sources[source];this.notice=source+' disconnected or sharing ended.';if(this.state==='recording'&&source!=='microphone')this.stopAll();else if(this.state!=='recording')this.state=Object.values(this.sourceState).some(Boolean)?'ready':'idle';this.notify();},{once:true});
  this.state='ready';this.notify();
 }
 async start(consent:CaptureConsent){
  this.requireConsent(consent);if(['recording','checking'].includes(this.state))throw Error('A recording is already running');if(this.pending.size)throw Error('Finish device permission requests before recording');if(typeof MediaRecorder==='undefined')throw Error('Recording is unavailable. Use uploaded evidence instead');
  const active=this.sourceState;if(!Object.values(active).some(Boolean))throw Error('Enable a camera, microphone or screen before recording');
  this.state='checking';this.notify();this.parts=[];this.clips=[];this.bytes=0;this.stopping=false;this.failed=false;this.finalized=false;this.notice='';this.sessionId=crypto.randomUUID();this.startedAt=Date.now();this.completion=new Promise(resolve=>{this.resolve=resolve});
  const microphone=this.sources.microphone?.getAudioTracks().filter(t=>t.readyState==='live')||[];
  const streams:{source:RecordedClip['source'];stream:MediaStream}[]=[];
  if(active.screen)streams.push({source:'screen',stream:new MediaStream([...this.sources.screen!.getVideoTracks(),...microphone])});
  if(active.camera)streams.push({source:'camera',stream:new MediaStream([...this.sources.camera!.getVideoTracks(),...(!active.screen?microphone:[])])});
  if(!streams.length&&microphone.length)streams.push({source:'audio',stream:new MediaStream(microphone)});
  try{
   for(const item of streams){
    const types=item.source==='audio'?['audio/webm;codecs=opus','audio/webm','audio/mp4']:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    const mime=types.find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw Error('No supported recording format for '+item.source);
    const recorder=new MediaRecorder(item.stream,{mimeType:mime}),part:Part={source:item.source,recorder,chunks:[],done:false,started:false};this.parts.push(part);
    recorder.ondataavailable=e=>{if(e.data.size){part.chunks.push(e.data);this.bytes+=e.data.size;if(this.bytes>=this.maximumBytes&&!this.stopping){this.notice='Session size limit reached. Your recordings were stopped and preserved.';this.stopAll();}}};
    recorder.onstop=()=>{part.done=true;this.finish();};
    recorder.onerror=()=>{this.failed=true;this.notice='A recorder failed. Available clips are preserved for local recovery.';this.stopAll();};
    recorder.start(1000);part.started=true;
   }
   this.state='recording';this.deadline=setTimeout(()=>{this.notice='Session time limit reached. Your recordings were stopped and preserved.';this.stopAll();},this.durationMs);this.notify();
  }catch(e){this.failed=true;this.notice=(e as Error).message;for(const part of this.parts)if(!part.started)part.done=true;this.stopAll();throw e;}
 }
 private stopAll(){if(this.stopping)return;this.stopping=true;if(this.deadline)clearTimeout(this.deadline);this.deadline=null;for(const part of this.parts){if(part.recorder.state==='recording')part.recorder.stop();else if(!part.started)part.done=true;}this.finish();}
 private finish(){if(this.finalized||this.parts.some(p=>!p.done))return;this.finalized=true;this.stopping=true;if(this.deadline)clearTimeout(this.deadline);this.deadline=null;const duration=Math.max(0,(Date.now()-(this.startedAt||Date.now()))/1000);this.clips=this.parts.filter(p=>p.chunks.some(b=>b.size)).map(p=>({source:p.source,blob:new Blob(p.chunks,{type:p.recorder.mimeType.split(';')[0]}),startedAt:new Date(this.startedAt!).toISOString(),durationSeconds:duration,sessionId:this.sessionId}));this.releaseDevices();this.state=this.failed?'failed':'stopped';this.resolve?.(this.clips);this.resolve=null;this.notify();}
 async stop(){if(!this.completion)throw Error('No recording exists');this.stopAll();return this.completion;}
 releaseDevices(){this.generation++;const streams=Object.values(this.sources);this.sources={};for(const stream of streams)stream?.getTracks().forEach(t=>t.stop());if(this.state!=='recording'&&this.state!=='checking'&&this.state!=='stopped'&&this.state!=='failed')this.state='idle';this.notify();}
 dispose(){this.disposed=true;this.generation++;this.notify=()=>{};if(this.deadline)clearTimeout(this.deadline);if(this.completion)this.stopAll();this.releaseDevices();}
}
