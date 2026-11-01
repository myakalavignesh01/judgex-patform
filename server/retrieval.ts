export function chunkText(text:string,size=1600,overlap=200){if(size<100||overlap<0||overlap>=size)throw Error('Invalid chunking parameters');const chunks:string[]=[];const normalized=text.replace(/\r\n/g,'\n').trim();for(let start=0;start<normalized.length;start+=size-overlap){chunks.push(normalized.slice(start,start+size));if(start+size>=normalized.length)break;}return chunks;}
export async function embed(config:{key:string;model:string},text:string,taskType:'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'){
 if(!config.key||!config.model)throw Error('Configure the embedding model before semantic retrieval');
 const model=config.model.replace(/^models\//,'');
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':embedContent',{method:'POST',headers:{'x-goog-api-key':config.key,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:'models/'+model,content:{parts:[{text:text.slice(0,10000)}]},taskType,outputDimensionality:768})});
 if(!r.ok)throw Error('Embedding provider failed ('+r.status+')');const d=await r.json(),v=d.embedding?.values;if(!Array.isArray(v)||v.length!==768||v.some(x=>typeof x!=='number'||!Number.isFinite(x)))throw Error('Invalid embedding dimensions');const norm=Math.sqrt(v.reduce((s,x)=>s+x*x,0));if(!norm)throw Error('Empty embedding');return v.map(x=>x/norm);
}
