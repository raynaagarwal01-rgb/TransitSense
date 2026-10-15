import assert from 'node:assert/strict';
import {createTraffic,spawnVehicle,stepTraffic,requestAmbulance,trafficLight,vehiclePosition,STOP_LINE,FOLLOWING_GAP,vehicleOnRoad,residentialWarnings} from './dist/traffic.mjs';
function verify(t,before){
 for(const v of t.vehicles){
  const previous=before?.get(v.id),j=t.junctions.find(j=>j.id===v.route.junction);
  if(previous&&v.laps===previous.laps&&previous.p+v.length/2<=-j.stopLine+.00001&&v.p+v.length/2>-j.stopLine+.00001){if(j.signalized)assert.equal(trafficLight(j,v.route.approach),'green','Vehicle crossed stop line without green');else assert.equal(j.reservation,v.id,'Vehicle entered without yielding');}
 }
 for(let i=0;i<t.vehicles.length;i++)for(let k=i+1;k<t.vehicles.length;k++){
  const a=t.vehicles[i],b=t.vehicles[k],pa=vehiclePosition(a),pb=vehiclePosition(b);
  if(!vehicleOnRoad(a)||!vehicleOnRoad(b))continue;
  const ax=a.route.axis===1?a.length:a.width,az=a.route.axis===1?a.width:a.length,bx=b.route.axis===1?b.length:b.width,bz=b.route.axis===1?b.width:b.length;
  assert.ok(Math.abs(pa.x-pb.x)>=(ax+bx)/2-.00001||Math.abs(pa.z-pb.z)>=(az+bz)/2-.00001,`Overlap: ${a.id}/${b.id} at ${a.p}/${b.p}`);
  if(a.route.id===b.route.id)assert.ok(Math.abs(a.p-b.p)>=(a.length+b.length)/2+FOLLOWING_GAP-.00001,'Following gap lost');
 }
 for(const j of t.junctions){if(!j.signalized){assert.equal(j.stage,'uncontrolled');continue;}const green=[0,1,2,3].filter(i=>trafficLight(j,i)==='green');assert.ok(!green.some(a=>green.some(b=>a%2!==b%2)),'Conflicting greens');}
}
const residential=createTraffic(),rj=residential.junctions[0];
assert.equal(rj.roadWidth,4.8);assert.equal(rj.signalized,false);assert.equal(trafficLight(rj,0),null);
assert.deepEqual(residentialWarnings(residential),['green','green','green','green']);
const approaching=spawnVehicle(residential,'Car','residential-0',{p:-20});
assert.deepEqual(residentialWarnings(residential),['green','red','red','red']);approaching.parked=true;assert.deepEqual(residentialWarnings(residential),['green','green','green','green']);
approaching.parked=false;approaching.p=24;assert.deepEqual(residentialWarnings(residential),['green','green','green','green']);approaching.p=1;assert.deepEqual(residentialWarnings(residential),['green','red','red','red']);
assert.deepEqual(residentialWarnings(residential,true),['red','red','red','red']);
for(const route of residential.routes.filter(r=>r.junction==='residential'))for(const type of ['Car','Truck','Two-wheeler']){
 const v=spawnVehicle(residential,type,route.id);assert.ok(v.lane+v.width/2<=rj.roadWidth/2,'Vehicle exceeds the narrow lane');
}
const t=createTraffic();assert.equal(t.junctions.length,2);assert.equal(t.routes.length,8);
for(const r of t.routes){const n=r.junction==='busy'?6:1;for(let i=0;i<n;i++)spawnVehicle(t,['Car','Truck','Two-wheeler'][i%3],r.id,{p:-25-i*8});}
let ambulance,dispatches=0;
for(let frame=0;frame<18000;frame++){
 if(frame%2300===50){ambulance=spawnVehicle(t,'Ambulance','busy-0',{forced:true});requestAmbulance(t,ambulance);dispatches++;}
 if(frame%197===0)spawnVehicle(t,['Truck','Car','Two-wheeler'][frame%3],t.routes[frame%8].id,{forced:true});
 const before=new Map(t.vehicles.map(v=>[v.id,{p:v.p,laps:v.laps}]));
 stepTraffic(t,1/60);verify(t,before);
}
for(let frame=0;frame<18000;frame++){
 const before=new Map(t.vehicles.map(v=>[v.id,{p:v.p,laps:v.laps}]));stepTraffic(t,1/60);verify(t,before);
}
assert.ok(t.completed>100,'Traffic must continue flowing');assert.ok(dispatches>5);assert.ok(!t.vehicles.some(v=>v.type==='Ambulance'),'Every ambulance must finish its route');
for(const r of t.routes)assert.ok(t.vehicles.some(v=>v.route.id===r.id&&!v.forced&&v.laps>0),'Every approach must receive a turn');
// Large time steps and repeated injection cannot jump a red light or create overlapping spawns.
const stress=createTraffic();for(let i=0;i<30;i++)spawnVehicle(stress,i%2?'Car':'Truck','busy-1',{p:-25});verify(stress);
for(let i=0;i<1000;i++){stepTraffic(stress,i%3===0?.2:.05);verify(stress);}
console.log(`Passed: 600 seconds, ${t.completed} completed trips, ${dispatches} ambulance dispatches; no overlaps, conflicting greens, red-light entries, yield violations, or lost following gaps. Red/green warning states and narrow-lane fit passed.`);

for(let side=0;side<4;side++){
 const empty=createTraffic();spawnVehicle(empty,'Car','residential-'+side,{p:-20});
 assert.deepEqual(residentialWarnings(empty),[0,1,2,3].map(i=>i===side?'green':'red'));
}
const simultaneous=createTraffic(),first=spawnVehicle(simultaneous,'Car','residential-1',{p:-20});stepTraffic(simultaneous,.1);spawnVehicle(simultaneous,'Car','residential-0',{p:-20});
assert.equal(simultaneous.junctions[0].reservation,first.id);assert.deepEqual(residentialWarnings(simultaneous),['red','green','red','red']);
