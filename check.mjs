import assert from 'node:assert/strict';
import {junctionWarning,classifySignature,forecastParking,parkingSchedule} from './dist/model.mjs';
assert.equal(junctionWarning({distance:20,approaching:true}),'warning');
assert.equal(junctionWarning({distance:20,approaching:false}),'clear');
assert.equal(junctionWarning({distance:40,approaching:true}),'clear');
assert.equal(junctionWarning({distance:0,approaching:true}),'clear');
assert.equal(junctionWarning({distance:20,approaching:false,fault:true}),'fault');
assert.equal(classifySignature(.25,.7),'Two-wheeler');assert.equal(classifySignature(.65,1.2),'Car');assert.equal(classifySignature(1,2),'Truck');
assert.deepEqual(forecastParking(10),{now:12,predicted:8,arrivals:9,departures:5});
for(let i=0;i<=60;i++)assert.ok(forecastParking(i).predicted>=0&&forecastParking(i).predicted<=30);
console.log('Passed: direction filtering, fail-safe warning, vehicle classes, and parking forecast bounds.');


const occupancy=Array.from({length:30},(_,i)=>i<18);for(let eta=1;eta<=20;eta++){const plan=parkingSchedule(occupancy,eta);assert.equal(plan.free,forecastParking(eta).predicted);assert.equal(new Set(plan.arriving).size,plan.arriving.length);}
