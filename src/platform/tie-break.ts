export function compareApproved(a:{weighted_total:number;scores:Record<string,number>},b:{weighted_total:number;scores:Record<string,number>},criteria:{id:string;tie_break_priority?:number|null}[]){
 const total=Number(b.weighted_total)-Number(a.weighted_total);if(total)return total;for(const c of [...criteria].filter(c=>c.tie_break_priority!=null).sort((x,y)=>x.tie_break_priority!-y.tie_break_priority!)){const delta=Number(b.scores[c.id])-Number(a.scores[c.id]);if(delta)return delta;}return 0;
}
