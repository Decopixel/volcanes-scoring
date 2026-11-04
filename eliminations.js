/* WA Scoring 0.6.3 PILOTO — motor de cuadros individuales, sin dependencias externas. */
(()=>{'use strict';
const sizes=[8,16,32];
function seedPositions(size){if(!sizes.includes(size))throw Error('Llave no admitida');let order=[1,4,3,2];while(order.length<size){const next=order.length*2;order=order.flatMap(seed=>[seed,next+1-seed]);}return order;}
function mode(division){return division==='Compuesto'?'cumulative':'sets';}
function makeGroup(category,players,size,officialOrder){
 if(!sizes.includes(size)||players.length<2||players.length>500)throw Error('Se requieren 2 o más participantes y una llave de 8, 16 o 32.');
 const sorted=[...players].sort((a,b)=>b.points-a.points||b.tens-a.tens||b.nines-a.nines||a.number-b.number);
 const tie=sorted.some((p,i)=>i&&p.points===sorted[i-1].points);
 if(tie&&!officialOrder)throw Error('Hay un empate en clasificación: registra y confirma el orden oficial antes de sembrar.');
 let ordered=sorted;
 if(officialOrder){const ids=String(officialOrder).split(/[\s,;]+/).filter(Boolean).map(Number),all=sorted.map(x=>x.number);
  if(ids.length!==all.length||new Set(ids).size!==all.length||ids.some(x=>!all.includes(x)))throw Error('El orden oficial debe contener una vez cada número inscrito en esta categoría.');
  ordered=ids.map(n=>sorted.find(x=>x.number===n));
  if(ordered.some((p,i)=>i>0&&p.points>ordered[i-1].points))throw Error('No puedes situar un menor puntaje sobre uno mayor. Solo se permite reordenar empates.');
 }
 const seeds=ordered.slice(0,size).map((p,i)=>({seed:i+1,number:p.number,points:p.points,tens:p.tens,nines:p.nines}));
 const places=seedPositions(size),bySeed=new Map(seeds.map(s=>[s.seed,s.number]));
 const matches=[];let n=size/2;
 for(let round=0;n>=1;round++,n=Math.floor(n/2))for(let index=0;index<n;index++)matches.push({id:`R${round+1}M${index+1}`,round,index,a:round===0?(bySeed.get(places[2*index])||null):null,b:round===0?(bySeed.get(places[2*index+1])||null):null,ends:[],shootOff:null,winner:null});
 const group={category,size,mode:mode(category.split(' / ')[0]),seeds,qualification:sorted.map(p=>({number:p.number,points:p.points,validated:!!p.validated})),matches,bronze:{id:'BRONZE',round:matches.at(-1).round,index:0,a:null,b:null,ends:[],shootOff:null,winner:null},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 return updateGroup(group);
}
function result(match,modeName,opening=false){
 if(opening&&((match.a&&!match.b)||(!match.a&&match.b)))return {winner:match.a||match.b,loser:null,bye:true,final:true};
 if(!match.a||!match.b)return {winner:null,loser:null,bye:false,final:false};
 let a=0,b=0,setsA=0,setsB=0;
 for(const end of match.ends||[]){if(!Number.isInteger(end.a)||!Number.isInteger(end.b)||end.a<0||end.a>30||end.b<0||end.b>30)throw Error('Tandas inválidas en eliminatorias.');
  a+=end.a;b+=end.b;if(end.a>end.b)setsA+=2;else if(end.b>end.a)setsB+=2;else{setsA++;setsB++;}
 }
 const max=5;
 if((match.ends||[]).length>max)throw Error('Solo se permiten cinco tandas.');
 if(modeName==='sets'){
  // Al llegar a seis puntos se acaba el enfrentamiento, salvo el 5-5 tras cinco sets.
  let pa=0,pb=0;for(let i=0;i<(match.ends||[]).length;i++){const x=match.ends[i];pa+=x.a>x.b?2:x.a===x.b?1:0;pb+=x.b>x.a?2:x.a===x.b?1:0;
   if((pa>=6||pb>=6)&&i<match.ends.length-1)throw Error('Se anotaron sets después de haberse decidido el enfrentamiento.');}
  if(setsA>=6||setsB>=6){const win=setsA>setsB?match.a:match.b;return {winner:win,loser:win===match.a?match.b:match.a,final:true,a:setsA,b:setsB};}
  if(match.ends.length===5&&setsA===5&&setsB===5){const win=match.shootOff;return {winner:win||null,loser:win?(win===match.a?match.b:match.a):null,final:!!win,needShootOff:!win,a:setsA,b:setsB};}
  if(match.shootOff)throw Error('No corresponde un desempate en este momento.');
  return {winner:null,loser:null,final:false,a:setsA,b:setsB};
 }
 if(match.ends.length===5){if(a!==b){const win=a>b?match.a:match.b;return {winner:win,loser:win===match.a?match.b:match.a,final:true,a,b};}
  const win=match.shootOff;return {winner:win||null,loser:win?(win===match.a?match.b:match.a):null,final:!!win,needShootOff:!win,a,b};}
 if(match.shootOff)throw Error('No corresponde un desempate en este momento.');
 return {winner:null,loser:null,final:false,a,b};
}
function subtreeHasSeeds(group,match){
 if(match.round===0)return !!(match.a||match.b);
 const prev=group.matches.filter(x=>x.round===match.round-1);
 return subtreeHasSeeds(group,prev[match.index*2])||subtreeHasSeeds(group,prev[match.index*2+1]);
}
function automaticBye(group,match){
 if(match.round===0)return true;
 if(!!match.a===!!match.b)return false;
 const prev=group.matches.filter(x=>x.round===match.round-1),emptyIndex=match.index*2+(match.a?1:0);
 return !subtreeHasSeeds(group,prev[emptyIndex]);
}
function matchResult(group,match){return result(match,group.mode,automaticBye(group,match));}
function updateGroup(group){
 // Si llega un resultado anterior nuevo, se prohíbe continuar si ya hay tandas posteriores.
 const ordered=[...group.matches].sort((a,b)=>a.round-b.round||a.index-b.index);
 for(const m of ordered){if(m.round>0){const prev=ordered.filter(p=>p.round===m.round-1);
   const aa=matchResult(group,prev[m.index*2]).winner;
   const bb=matchResult(group,prev[m.index*2+1]).winner;
   if((m.ends.length||m.shootOff)&&(m.a!==aa||m.b!==bb))throw Error('Cambió un clasificado pero la siguiente ronda ya tiene resultados. Requiere revisión oficial.');
   m.a=aa||null;m.b=bb||null;
  }
  m.winner=matchResult(group,m).winner;
 }
 const semi=ordered.filter(x=>x.round===Math.log2(group.size)-2);
 // Un bronce solo tiene sentido en cuadros de al menos cuatro participantes.
 const aa=semi.length===2?matchResult(group,semi[0]).loser:null;
 const bb=semi.length===2?matchResult(group,semi[1]).loser:null;
 if((group.bronze.ends.length||group.bronze.shootOff)&&(group.bronze.a!==aa||group.bronze.b!==bb))throw Error('Cambió una semifinal con un bronce ya anotado.');
 group.bronze.a=aa||null;group.bronze.b=bb||null;group.bronze.winner=result(group.bronze,group.mode).winner;
 group.updatedAt=new Date().toISOString();return group;
}
function setMatch(group,id,ends,shootOff){const copy=JSON.parse(JSON.stringify(group));const match=id==='BRONZE'?copy.bronze:copy.matches.find(m=>m.id===id);if(!match||!match.a||!match.b)throw Error('Este enfrentamiento todavía no tiene dos arqueros.');
 match.ends=ends;match.shootOff=shootOff||null;result(match,copy.mode,match.round===0);return updateGroup(copy);}
function podium(group){const final=group.matches.find(m=>m.round===Math.log2(group.size)-1),gold=matchResult(group,final),bronze=result(group.bronze,group.mode);
 const semi=group.matches.filter(m=>m.round===Math.log2(group.size)-2);
 const automaticThird=group.seeds.length===3?semi.map(m=>matchResult(group,m).loser).find(Boolean):null;
 return {gold:gold.winner||null,silver:gold.loser||null,bronze:bronze.winner||automaticThird||null,fourth:bronze.loser||null,
 complete:!!(gold.final&&(group.seeds.length<4||bronze.final))};}

window.WA_ELIM={sizes,seedPositions,mode,makeGroup,result,matchResult,updateGroup,setMatch,podium};
})();
