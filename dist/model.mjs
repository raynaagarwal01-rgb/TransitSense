export function junctionWarning({distance,approaching,fault=false}){return fault?'fault':approaching&&distance>0&&distance<32?'warning':'clear'}
export function classifySignature(peak,width){return peak<.4&&width<1?'Two-wheeler':peak>.8&&width>1.5?'Truck':'Car'}
// shortcut: scripted arrivals and departures illustrate forecasting; replace with validated camera history before real deployment.
export function forecastParking(minutes,occupied=18,capacity=30){const arrivals=Math.round(minutes*.9),departures=Math.round(minutes*.45);return {now:capacity-occupied,predicted:Math.max(0,Math.min(capacity,capacity-occupied-arrivals+departures)),arrivals,departures}}

export function parkingSchedule(occupied,minutes){const f=forecastParking(minutes,occupied.filter(Boolean).length,occupied.length),departing=occupied.flatMap((v,i)=>v?[i]:[]).slice(0,f.departures),arriving=occupied.flatMap((v,i)=>!v?[i]:[]).concat(departing).slice(0,f.arrivals);return {departing,arriving,free:occupied.filter(v=>!v).length+departing.length-arriving.length}}
