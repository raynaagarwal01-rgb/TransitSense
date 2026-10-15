import assert from 'node:assert/strict';
import {junctionWarning,classifySignature,forecastParking,planArrival,nextOpening,DEMAND} from './dist/model.mjs';
assert.equal(junctionWarning({distance:20,approaching:true}),'warning');
assert.equal(junctionWarning({distance:20,approaching:false}),'clear');
assert.equal(junctionWarning({distance:40,approaching:true}),'clear');
assert.equal(junctionWarning({distance:0,approaching:true}),'clear');
assert.equal(junctionWarning({distance:20,approaching:false,fault:true}),'fault');
assert.equal(classifySignature(.25,.7),'Two-wheeler');assert.equal(classifySignature(.65,1.2),'Car');assert.equal(classifySignature(1,2),'Truck');
assert.deepEqual(forecastParking(10),{now:12,predicted:8,arrivals:9,departures:5});
for(let i=0;i<=60;i++)assert.ok(forecastParking(i).predicted>=0&&forecastParking(i).predicted<=30);
console.log('Passed: direction filtering, fail-safe warning, vehicle classes, and parking forecast bounds.');


const occupancy=Array.from({length:30},(_,i)=>i<18),cost=occupancy.map((_,i)=>Math.abs(i-24)+i%3),departOrder=occupancy.flatMap((v,i)=>v?[i]:[]).reverse(),options={cost,departOrder};
for(let eta=1;eta<=20;eta++){
  const plan=planArrival(occupancy,eta,options),taken=plan.events.filter(e=>e.type==='arrive').map(e=>e.bay);
  assert.equal(plan.free,forecastParking(eta).predicted);assert.equal(plan.turnedAway,0);
  assert.equal(new Set(taken).size,taken.length);assert.ok(!taken.includes(null));
  assert.ok(plan.bay!==null&&plan.freeBays.every(b=>cost[b]>=cost[plan.bay]));
  assert.ok(plan.freedAt===null||plan.freedAt<=eta);
}
const rush={...options,rates:DEMAND.rush};
assert.notEqual(planArrival(occupancy,3,rush).bay,null);
const full=planArrival(occupancy,20,rush);assert.equal(full.bay,null);assert.ok(full.turnedAway>0);
const opening=nextOpening(occupancy,20,rush);assert.ok(opening===null||(opening>20&&planArrival(occupancy,opening,rush).bay!==null));
console.log('Passed: bay-level parking prediction, nearest free bay, and full-garage handling.');
