export function junctionWarning({distance,approaching,fault=false}){return fault?'fault':approaching&&distance>0&&distance<32?'warning':'clear'}
export function classifySignature(peak,width){return peak<.4&&width<1?'Two-wheeler':peak>.8&&width>1.5?'Truck':'Car'}
// shortcut: scripted arrivals and departures illustrate forecasting; replace with validated camera history before real deployment.
export const DEMAND={normal:{arrive:.9,depart:.45},rush:{arrive:1.5,depart:.3}};
export function forecastParking(minutes,occupied=18,capacity=30,rates=DEMAND.normal){const arrivals=Math.round(minutes*rates.arrive),departures=Math.round(minutes*rates.depart);return {now:capacity-occupied,predicted:Math.max(0,Math.min(capacity,capacity-occupied-arrivals+departures)),arrivals,departures}}


// Replays the predicted departures and arrivals up to the driver's arrival time, bay by bay.
// occupied: true/false per bay now · cost: lower is better (driving distance from the entrance)
// departOrder: occupied bays in the order the camera history expects them to leave.
// Each earlier arrival takes the best free bay; the driver gets the best bay still free on arrival.
export function planArrival(occupied,minutes,{cost,departOrder,rates=DEMAND.normal}){
  const state=[...occupied],freedAt=new Map(),events=[];
  const departures=Math.min(Math.round(minutes*rates.depart),departOrder.length),arrivals=Math.round(minutes*rates.arrive);
  for(let k=0;k<departures;k++)events.push({t:(k+.5)/rates.depart,type:'depart',bay:departOrder[k]});
  for(let k=0;k<arrivals;k++)events.push({t:(k+.5)/rates.arrive,type:'arrive',bay:null});
  events.sort((a,b)=>a.t-b.t||(a.type==='depart'?-1:1));
  const best=()=>{let pick=null;for(let i=0;i<state.length;i++)if(!state[i]&&(pick===null||cost[i]<cost[pick]))pick=i;return pick};
  let turnedAway=0;
  for(const e of events){
    if(e.type==='depart'){state[e.bay]=false;freedAt.set(e.bay,e.t);continue}
    e.bay=best();if(e.bay===null){turnedAway++;continue}
    state[e.bay]=true;freedAt.delete(e.bay);
  }
  const freeBays=state.flatMap((taken,i)=>taken?[]:[i]).sort((a,b)=>cost[a]-cost[b]||a-b),bay=freeBays.length?freeBays[0]:null;
  return {events,freeBays,bay,backup:freeBays.length>1?freeBays[1]:null,freedAt:bay===null?null:freedAt.get(bay)??null,
    now:occupied.filter(v=>!v).length,free:freeBays.length,arrivals,departures,turnedAway,capacity:occupied.length};
}

// Earliest later arrival time (whole minutes, up to `horizon` later) at which a bay is predicted free.
export function nextOpening(occupied,minutes,options,horizon=30){
  for(let m=minutes+1;m<=minutes+horizon;m++)if(planArrival(occupied,m,options).bay!==null)return m;
  return null;
}
