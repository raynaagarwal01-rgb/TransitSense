export const STOP_LINE=16;
export const FOLLOWING_GAP=2;
export const DISTRICTS=[
  {id:'residential',name:'Maple & Willow',x:-48,z:-30,greenDuration:7,demand:1,speed:4,roadWidth:4.8,laneOffset:1.2,stopLine:6.5,signalized:false},
  {id:'busy',name:'Civic Square',x:48,z:30,greenDuration:11,demand:6,speed:9,roadWidth:13,laneOffset:2.7,stopLine:16,signalized:true}
];
export function vehicleSize(type){
  if(type==='Bus')return {length:7.8,width:2.45};
  if(type==='Truck')return {length:5.6,width:2.3};
  if(type==='Two-wheeler')return {length:2.1,width:.85};
  return {length:3.7,width:1.95};
}
export function createTraffic(){
  const junctions=DISTRICTS.map(j=>({...j,axis:0,stage:j.signalized?'green':'uncontrolled',elapsed:0,priority:null,reservation:null}));
  const routes=junctions.flatMap(j=>Array.from({length:4},(_,approach)=>({id:j.id+'-'+approach,junction:j.id,approach,axis:approach%2,angle:approach*Math.PI/2,x:j.x,z:j.z,end:62,speed:j.speed,laneOffset:j.laneOffset})));
  return {junctions,routes,vehicles:[],nextId:1,completed:0,nextYieldOrder:1};
}
export function spawnVehicle(traffic,type,routeId,{p=-60,forced=false,departing=false}={}){
  const route=traffic.routes.find(r=>r.id===routeId);
  if(!route)throw new Error('Unknown traffic route: '+routeId);
  const size=vehicleSize(type),lane=traffic.vehicles.filter(v=>v.route.id===routeId&&!v.parked);
  // Entry sources queue outside the scene instead of spawning inside an existing vehicle.
  for(const other of lane){const spacing=(size.length+other.length)/2+FOLLOWING_GAP;
    p=departing?Math.max(p,other.p+spacing):Math.min(p,other.p-spacing);
  }
  const v={id:traffic.nextId++,type,route,p,...size,lane:route.laneOffset,speed:type==='Truck'||type==='Bus'?route.speed*.8:route.speed,velocity:0,forced,counted:false,laps:0};
  traffic.vehicles.push(v);return v;
}
export function requestAmbulance(traffic,v){
  const j=traffic.junctions.find(j=>j.id===v.route.junction);
  if(v.type!=='Ambulance')throw new Error('Priority requires an ambulance');
  j.priority={vehicleId:v.id,approach:v.route.approach};j.stage='clearing';j.elapsed=0;
}
export function trafficLight(j,approach){
  if(!j.signalized)return null;
  if(j.stage==='clearing')return 'red';
  if(j.priority)return j.stage==='priority'&&j.priority.approach===approach?'green':'red';
  if(j.axis!==approach%2)return 'red';
  return j.stage==='green'?'green':j.stage==='amber'?'amber':'red';
}
export function vehiclePosition(v){
  const a=v.route.approach;
  return {x:v.route.x+([0,1,0,-1][a])*v.p+([1,0,-1,0][a])*v.lane,
          z:v.route.z+([1,0,-1,0][a])*v.p-([0,1,0,-1][a])*v.lane};
}
export function junctionOccupied(traffic,j){
  return traffic.vehicles.some(v=>!v.parked&&v.route.junction===j.id&&v.p+v.length/2>-j.stopLine+.00001&&v.p-v.length/2<j.stopLine);
}
function updateSignals(traffic,dt){
  for(const j of traffic.junctions){
    if(!j.signalized){
      const active=traffic.vehicles.find(v=>v.id===j.reservation);
      if(!active||active.parked||active.p-active.length/2>j.stopLine)j.reservation=null;
      for(const v of traffic.vehicles)if(v.route.junction===j.id&&!v.parked&&v.p<0&&v.p+v.length/2>=-32&&v.yieldOrder===undefined)v.yieldOrder=traffic.nextYieldOrder++;
      if(j.reservation===null){const waiting=traffic.vehicles.filter(v=>v.route.junction===j.id&&!v.parked&&v.p<0&&v.yieldOrder!==undefined).sort((a,b)=>a.yieldOrder-b.yieldOrder);j.reservation=waiting[0]?.id??null;}
      continue;
    }
    j.elapsed+=dt;
    if(j.stage==='priority'){
      const ambulance=traffic.vehicles.find(v=>v.id===j.priority.vehicleId);
      if(!ambulance||ambulance.p-ambulance.length/2>STOP_LINE){j.priority=null;j.stage='clearing';j.elapsed=0;}
    }else if(j.stage==='green'&&j.elapsed>=j.greenDuration){j.stage='amber';j.elapsed=0;}
    else if(j.stage==='amber'&&j.elapsed>=2){j.stage='clearing';j.elapsed=0;}
    else if(j.stage==='clearing'&&j.elapsed>=2&&!junctionOccupied(traffic,j)){
      j.axis=j.priority?j.priority.approach%2:1-j.axis;j.stage=j.priority?'priority':'green';j.elapsed=0;
    }
  }
}
export function stepTraffic(traffic,dt){
  if(!Number.isFinite(dt)||dt<0)throw new Error('Traffic time step must be finite and non-negative');
  const removed=[];
  // Fixed substeps keep stopping and clearance deterministic at every playback speed.
  const steps=Math.ceil(dt/(1/30)),step=steps?dt/steps:0;
  for(let n=0;n<steps;n++){
    updateSignals(traffic,step);
    for(const route of traffic.routes){
      const j=traffic.junctions.find(j=>j.id===route.junction);
      const lane=traffic.vehicles.filter(v=>v.route.id===route.id&&!v.parked).sort((a,b)=>b.p-a.p);
      for(let i=0;i<lane.length;i++){
        const v=lane[i],leader=lane[i-1];let limit=Infinity;
        if(leader)limit=leader.p-(leader.length+v.length)/2-FOLLOWING_GAP;
        const stop=-j.stopLine-v.length/2;
        if(v.p<=stop+.00001){
          // Keep the box clear only when the car ahead is actually stuck past the junction, not just driving away.
          const exitBlocked=leader&&leader.p-leader.length/2<j.stopLine+v.length+FOLLOWING_GAP&&leader.p-leader.length/2>-j.stopLine&&leader.velocity<1;
          if((j.signalized?trafficLight(j,route.approach)!=='green':j.reservation!==v.id)||exitBlocked)limit=Math.min(limit,stop);
        }
        const distance=Math.max(0,limit-v.p),targetSpeed=Math.min(v.speed,Math.sqrt(8*distance));
        v.velocity=Math.min(targetSpeed,v.velocity+3*step);
        const next=Math.min(v.p+v.velocity*step,limit);
        v.velocity=Math.max(0,(next-v.p)/step);v.p=Math.max(v.p,next);
      }
    }
    for(const v of [...traffic.vehicles])if(v.p>v.route.end+v.length){
      if(v.forced){traffic.vehicles.splice(traffic.vehicles.indexOf(v),1);removed.push(v);}
      else{
        let entry=-v.route.end;
        for(const other of traffic.vehicles)if(other!==v&&other.route.id===v.route.id&&!other.parked)entry=Math.min(entry,other.p-(other.length+v.length)/2-FOLLOWING_GAP);
        v.p=entry;v.velocity=0;v.counted=false;delete v.yieldOrder;v.laps++;traffic.completed++;
      }
    }
  }
  return removed;
}

export function vehicleOnRoad(v){return Math.abs(v.p)<=v.route.end;}

export function residentialWarnings(traffic,fault=false){
  if(fault)return ['red','red','red','red'];
  const j=traffic.junctions.find(j=>j.id==='residential');
  const approaching=traffic.vehicles.filter(v=>v.route.junction===j.id&&!v.parked&&!v.outgoing&&v.p+v.length/2>=-32&&v.p-v.length/2<j.stopLine);
  const first=approaching.find(v=>v.id===j.reservation)||approaching.sort((a,b)=>(a.yieldOrder??a.id)-(b.yieldOrder??b.id))[0];
  return [0,1,2,3].map(side=>!first||side===first.route.approach?'green':'red');
}
