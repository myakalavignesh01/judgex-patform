export type RecordingState='idle'|'checking'|'recording'|'stopped'|'failed';
/** Capture is called only from an explicit participant action after recording consent. */
export class PresentationCapture {
 private recorder:MediaRecorder|null=null;
 private streams:MediaStream[]=[];
 private parts:Blob[]=[];
 state:RecordingState='idle';
 startedAt:number|null=null;
 get previewStream(){return this.streams.at(-1)||null;}
 async start(consent:{accepted:boolean;policyVersion:string;screen:boolean},onState:(state:RecordingState)=>void){
  if(!consent.accepted||!consent.policyVersion)throw Error('Accept the recording policy before starting');
  if(this.state==='recording')throw Error('A recording is already running');
  if(!navigator.mediaDevices||!window.MediaRecorder)throw Error('Recording is unavailable. Use the event’s manual submission alternative.');
  this.state='checking';onState(this.state);
  try{
   const camera=await navigator.mediaDevices.getUserMedia({video:!consent.screen,audio:true});this.streams.push(camera);
   let captured=camera;
   if(consent.screen){const screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});this.streams.push(screen);captured=new MediaStream([...screen.getVideoTracks(),...camera.getAudioTracks()]);screen.getVideoTracks()[0].addEventListener('ended',()=>{if(this.recorder?.state==='recording')this.recorder.stop()},{once:true});}
   const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
   this.parts=[];this.recorder=new MediaRecorder(captured,mime?{mimeType:mime}:undefined);
   this.recorder.ondataavailable=e=>{if(e.data.size){this.parts.push(e.data);if(this.parts.reduce((size,part)=>size+part.size,0)>90*1024*1024&&this.recorder?.state==='recording')this.recorder.stop()}};
   this.recorder.onstop=()=>{this.releaseDevices();this.state='stopped';onState(this.state)};
   this.recorder.onerror=()=>{this.releaseDevices();this.state='failed';onState(this.state)};
   this.recorder.start(1000);this.startedAt=Date.now();this.state='recording';onState(this.state);
  }catch(e){this.releaseDevices();this.state='failed';onState(this.state);throw e;}
 }
 async stop():Promise<Blob>{
  const recorder=this.recorder;if(!recorder)throw Error('No recording exists');
  if(recorder.state==='recording')await new Promise<void>(resolve=>{recorder.addEventListener('stop',()=>resolve(),{once:true});recorder.stop()});
  return new Blob(this.parts,{type:recorder.mimeType});
 }
 releaseDevices(){for(const stream of this.streams)for(const track of stream.getTracks())track.stop();this.streams=[];}
 dispose(){if(this.recorder){this.recorder.ondataavailable=null;this.recorder.onstop=null;this.recorder.onerror=null;if(this.recorder.state==='recording')this.recorder.stop();}this.releaseDevices();this.parts=[];}
}
