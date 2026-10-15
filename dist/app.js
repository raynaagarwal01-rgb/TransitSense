import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {classifySignature,forecastParking,parkingSchedule} from './model.mjs';
import {DISTRICTS,createTraffic,spawnVehicle,stepTraffic,requestAmbulance,trafficLight,vehiclePosition,vehicleOnRoad,residentialWarnings} from './traffic.mjs';
const $=id=>document.getElementById(id);
const config={
 s1:{district:'RESIDENTIAL ZONE',title:'See around the corner.<br>Cross with confidence.',description:'Roadside sensors spot hidden traffic<br>and warn every approach in real time.',name:'Junction warning',copy:'A directional roadside sensor detects a vehicle approaching the blind junction. Its own post stays green while the other three turn red, and all four return to green once the junction clears. Parked and departing vehicles are ignored.',location:'Lakeview Crossing',type:'Narrow residential lanes · No traffic signals',action:'Send approaching car',note:'Directional IoT sensor · Low warning posts'},
 s2:{district:'CITY CENTRE',title:'Sirens heard.<br>Signals cleared.',description:'Acoustic sensors locate emergency vehicles<br>and turn the signals in their favour.',name:'Ambulance priority',copy:'A pair of acoustic sensors locates an approaching siren. After an all-red clearance, its approach stays green until the ambulance has passed.',location:'Central Square',type:'Four-way signalized intersection',action:'Dispatch ambulance',note:'Acoustic sensor pair · Direction-aware siren detection'},
 s3:{district:'TRAFFIC CORRIDOR',title:'Count every vehicle.<br>Know every class.',description:'Road-embedded magnetometers read each passing vehicle<br>to build a live picture of traffic flow.',name:'Magnetic signature',copy:'A road-embedded magnetometer reads the shape and strength of each magnetic disturbance to count two-wheelers, cars and trucks and tell them apart.',location:'Ring Road East',type:'Live vehicle counting & classification',action:'Send a car',note:'Embedded magnetometer · Illustrative waveforms'},
 s5:{district:'PARKING HUB',title:'Know the space<br>before you arrive.',description:'Zone cameras track every bay<br>and forecast what will be free when you get there.',name:'Predictive parking',copy:'One camera per zone tracks occupancy and movement. The forecast accounts for arrivals and departures before you reach the car park.',location:'Central Park & Ride',type:'Building cutaway · 3 camera zones',action:'Simulate arrival forecast',note:'One camera per zone · Simulated parking forecast'}
};
let current='s1',time=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,speed=1,vehicleType='Car',fault=false,priority=null,priorityStart=0,focusCar=null,echoUntil=0,eta=10,forecastActive=false,roofVisible=false;
let counts={'Two-wheeler':0,Car:0,Truck:0},lastSignature=null,vehicles=[],signals=[],beacons=[],pulses=[],worldLabels=[],slots=[],roof=null,priorityRoute=null,traffic=null,ambulanceCar=null,viewMode='overview',sensorLabel=null;
const districtLabels=new Map();
const scene=new THREE.Scene();scene.background=new THREE.Color('#152733');scene.fog=new THREE.FogExp2('#152733',.0024);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){$('load-detail').textContent='This device needs WebGL to render the city. Try a current browser with hardware acceleration enabled.';throw e}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;$('city').appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.1,600);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=30;controls.maxDistance=330;controls.minPolarAngle=.25;controls.maxPolarAngle=1.32;controls.enablePan=true;
const hemi=new THREE.HemisphereLight('#c5e2ea','#4a6053',2.7);scene.add(hemi);
const sun=new THREE.DirectionalLight('#ffdfb0',3.4);sun.position.set(-45,105,30);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-140,right:140,top:140,bottom:-140,near:1,far:240});sun.shadow.bias=-.0004;sun.shadow.normalBias=.06;scene.add(sun);
const fill=new THREE.DirectionalLight('#88bce6',1.1);fill.position.set(30,20,-40);scene.add(fill);
const world=new THREE.Group();scene.add(world);
const gableGeometry=new THREE.BufferGeometry();gableGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,-.5,.5,-.5,-.5,0,.5,-.5,-.5,-.5,.5,.5,-.5,.5,0,.5,.5],3));gableGeometry.setIndex([0,2,1,3,4,5,0,1,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,4]);const gableRoof=gableGeometry.toNonIndexed();gableRoof.computeVertexNormals();
const geos={gable:gableRoof,hip:new THREE.ConeGeometry(1,1,4).rotateY(Math.PI/4),box:new THREE.BoxGeometry(1,1,1),sphere:new THREE.IcosahedronGeometry(1,1),cylinder:new THREE.CylinderGeometry(1,1,1,10),cone:new THREE.ConeGeometry(1,1,4)};
const materialCache=new Map();function mat(color,emissive=false){const key=color+emissive;if(!materialCache.has(key))materialCache.set(key,new THREE.MeshStandardMaterial({color,roughness:.83,metalness:.05,emissive:emissive?color:'#000000',emissiveIntensity:emissive?.7:0}));return materialCache.get(key)}
let batches=new Map();const transform=new THREE.Object3D();
function shape(type,x,y,z,w,h,d,color,rotation=0,emissive=false){const key=type+color+emissive;if(!batches.has(key))batches.set(key,{type,color,emissive,items:[]});batches.get(key).items.push([x,y,z,w,h,d,rotation])}
const box=(x,y,z,w,h,d,c,r=0,e=false)=>shape('box',x,y,z,w,h,d,c,r,e);
function flush(){for(const {type,color,emissive,items} of batches.values()){const mesh=new THREE.InstancedMesh(geos[type],mat(color,emissive),items.length);items.forEach((v,i)=>{transform.position.set(v[0],v[1],v[2]);transform.scale.set(v[3],v[4],v[5]);transform.rotation.set(0,v[6],0);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix)});mesh.castShadow=!emissive;mesh.receiveShadow=true;world.add(mesh)}batches.clear()}
function meshBox(parent,x,y,z,w,h,d,color,emissive=false){const m=new THREE.Mesh(geos.box,mat(color,emissive));m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
let seed=17;function random(){seed=(seed*16807)%2147483647;return (seed-1)/2147483646}
function tree(x,z,s=1){shape('cylinder',x,1.6*s,z,.25*s,3.2*s,.25*s,'#635c48');shape('sphere',x,4*s,z,2.1*s,2.6*s,2.1*s,'#547c5e');shape('sphere',x-.6*s,4.7*s,z+.2*s,1.6*s,2*s,1.6*s,'#6a9171')}
function lamp(x,z){box(x,2.4,z,.13,4.8,.13,'#849496');box(x+.55,4.8,z,1.3,.14,.35,'#adb7af');box(x+.9,4.7,z,.5,.08,.4,'#ffe2a0',0,true);box(x,0.16,z,.5,.22,.5,'#8c9b97')}
function house(x,z,r=0){
 const hb=(lx,y,lz,w,h,d,c,e=false)=>box(x+Math.cos(r)*lx+Math.sin(r)*lz,y,z-Math.sin(r)*lx+Math.cos(r)*lz,w,h,d,c,r,e);
 const w=5.2+random()*2.3,d=5.5+random()*2,h=random()<.65?3.2:5.7,roofStyle=Math.floor(random()*3);
 const walls=['#e7d6bb','#d5a58a','#b7c9b1','#d7cfbe','#c1cbd1','#e1bd87'][Math.floor(random()*6)],roofColor=['#8d6154','#53636a','#748276','#a5755e'][Math.floor(random()*4)];
 hb(0,.1,-.5,w+3,.12,d+5,'#67816b');hb(0,h/2+.3,0,w,h,d,walls);hb(0,.3,0,w+.3,.3,d+.3,'#b6b2a0');
 if(roofStyle===0)hb(0,h+.5,0,w+.7,.4,d+.7,roofColor);
 else shape(roofStyle===1?'gable':'hip',x,h+1.15,z,roofStyle===1?w+.8:(w+.8)/Math.SQRT2,1.7,roofStyle===1?d+.8:(d+.8)/Math.SQRT2,roofColor,r);
 hb(0,1.3,-d/2-.03,1,2,.08,'#637b76');hb(0,.35,-d/2-.6,2.2,.25,1.4,'#d0c8b6');hb(0,2.8,-d/2-.6,2.5,.16,1.6,roofColor);
 for(const xx of [-w*.29,w*.29])for(const yy of h>5?[1.9,4.4]:[1.9]){hb(xx,yy,-d/2-.045,1,1.1,.09,'#f3d698',true);hb(xx,yy,-d/2-.11,.07,1.2,.05,'#ede4ce');hb(xx,yy,-d/2-.11,1.08,.06,.05,'#ede4ce')}
 for(const side of [-1,1])hb(side*(w/2+.03),h>5?4.3:1.8,0,.06,1.1,1.1,'#c2d9d5');
 hb(0,.18,-d/2-1.8,.8,.05,2.3,'#c9c3b2');hb(w*.32,.19,-d/2-1.8,1.9,.05,2.3,'#9c9e93');
 const fenceColor=random()<.5?'#8a9a7d':'#c7c4ae';for(const side of [-1,1]){hb(side*(w/2+1.3),.65,-.4,.13,.85,d+4.5,fenceColor);hb(side*(w/2+1.15),.65,-d/2-2.55,.4,.85,.13,fenceColor)}
 hb(-w*.3,.7,-d/2-2.55,w*.55,.8,.15,fenceColor);
 if(random()<.45)hb(w*.3,h+1.1,d*.15,.6,1.5,.6,'#a28b77');
 const lx=-(w/2+.5),lz=d/2+.8;tree(x+Math.cos(r)*lx+Math.sin(r)*lz,z-Math.sin(r)*lx+Math.cos(r)*lz,.38+random()*.2);
}
function residentialHomes(){
 const j=DISTRICTS[0];
 for(const side of [-1,1])for(const arm of [-1,1]){
  for(let i=0;i<5;i++)house(j.x+side*(10.5+random()*1.2),j.z+arm*(10+i*12+(random()-.5)*2),side*Math.PI/2);
  for(let i=0;i<4;i++)house(j.x+arm*(23+i*12+(random()-.5)*2),j.z+side*(10.5+random()*1.2),side>0?0:Math.PI);
 }
}
function tower(x,z,w,d,h){box(x,h/2,z,w,h,d,'#75878d');box(x,h+.3,z,w+.4,.6,d+.4,'#4a5e67');box(x,1,z,w+.8,2,d+.8,'#586d75');for(let y=3;y<h-1;y+=2.4){for(let xx=-w/2+1;xx<w/2;xx+=1.6){const color=random()>.38?'#d9bb79':'#49636d';box(x+xx,y,z+d/2+.025,.75,1.15,.05,color,0,color==='#d9bb79');box(x+xx,y,z-d/2-.025,.75,1.15,.05,color,0,color==='#d9bb79')}for(let zz=-d/2+1;zz<d/2;zz+=1.6){box(x+w/2+.025,y,z+zz,.05,1.15,.75,'#839e9e');box(x-w/2-.025,y,z+zz,.05,1.15,.75,'#d9bb79',0,true)}}box(x+1,h+1.2,z,2,1.5,2,'#5a7079')}
function road(angle,width=13,length=132,cx=0,cz=0){
 box(cx,-.03,cz,width+1.4,.26,length,'#a3b2ab',angle);box(cx,.12,cz,width,.15,length,'#394b55',angle);
 const pos=(x,z)=>[cx+Math.cos(angle)*x+Math.sin(angle)*z,cz-Math.sin(angle)*x+Math.cos(angle)*z];
 for(let p=-length/2+3;p<length/2;p+=5){if(Math.abs(p)<(width<6?5:16))continue;const [x,z]=pos(0,p);box(x,.215,z,.15,.018,2,'#ddd7b2',angle)}
 for(const side of [-1,1]){for(const p of [-41,41]){const [x,z]=pos(side*(width/2-.65),p);box(x,.215,z,.10,.018,50,'#9baaa6',angle)}}
}
function crosswalk(angle,j){
 for(let i=-4;i<=4;i++){const x=j.x+Math.cos(angle)*i+Math.sin(angle)*12,z=j.z-Math.sin(angle)*i+Math.cos(angle)*12;box(x,.225,z,.65,.025,2.3,'#d3d6c9',angle)}
 const x=j.x+Math.sin(angle)*16,z=j.z+Math.cos(angle)*16;
 box(x+Math.cos(angle)*-3.2,.23,z-Math.sin(angle)*-3.2,5.2,.04,.35,'#f0eedc',angle);
}
function label(text,x,y,z,tone=''){const el=document.createElement('div');el.className='world-label '+tone;el.innerHTML='<i></i><span>'+text+'</span>';$('labels').appendChild(el);const item={el,position:new THREE.Vector3(x,y,z)};worldLabels.push(item);return item}
function ring(x,z,color,r=5){const geometry=new THREE.RingGeometry(r-.12,r,64);const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false});const m=new THREE.Mesh(geometry,material);m.rotation.x=-Math.PI/2;m.position.set(x,.26,z);world.add(m);pulses.push(m);return m}
const postMaterials={red:new THREE.MeshBasicMaterial({color:'#ff3434',toneMapped:false}),green:new THREE.MeshBasicMaterial({color:'#43ed8b',toneMapped:false})};
function beacon(x,z,approach){
 shape('cylinder',x,.27,z,.23,.12,.23,'#535b56');shape('cylinder',x,.61,z,.095,.62,.095,'#ded9c5');shape('cylinder',x,.73,z,.105,.12,.105,'#424f4b');
 const glow=new THREE.Mesh(geos.sphere,postMaterials.green);glow.position.set(x,1.02,z);glow.scale.set(.22,.22,.22);world.add(glow);glow.userData.approach=approach;beacons.push(glow);
}
function signal(j,approach){
 const angle=approach*Math.PI/2,g=new THREE.Group();
 const x=j.x+Math.sin(angle)*-16+Math.cos(angle)*7.6,z=j.z+Math.cos(angle)*-16-Math.sin(angle)*7.6;
 g.position.set(x,0,z);g.rotation.y=angle;world.add(g);
 meshBox(g,0,3.8,0,.24,7.6,.24,'#93a6a8');meshBox(g,-2.5,7.5,0,5.4,.24,.24,'#93a6a8');
 meshBox(g,-4.9,6.3,0,1.25,3.1,.72,'#102128');
 const lamps=['#ff493c','#ffc247','#8cfa8c'].map((color,i)=>[-.43,.43].map(z=>{
   const lens=new THREE.Mesh(geos.sphere,mat(color,true));lens.position.set(-4.9,7.22-i*.9,z);lens.scale.set(.4,.4,.17);g.add(lens);return lens;
 }));
 signals.push({lamps,junction:j.id,approach});box(x,.26,z,1,.2,1,'#a4b2aa');
}
const carModels=new Map();
const carBodyMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:.05});
const carLightMaterial=new THREE.MeshBasicMaterial({vertexColors:true});
function carFromModel(model,type){
 const g=new THREE.Group();g.add(new THREE.Mesh(model.body,carBodyMaterial),new THREE.Mesh(model.lights,carLightMaterial));g.children[0].castShadow=true;
 if(model.flash){g.userData.flash=model.flash.clone();g.add(g.userData.flash)}g.userData.type=type;return g;
}
function combineCarParts(group,glowing){
 const positions=[],normals=[],colors=[],indices=[];
 for(const part of group.children){
  if(part===group.userData.flash||!!part.material.emissive.getHex()!==glowing)continue;
  part.updateMatrix();const geometry=part.geometry.clone().applyMatrix4(part.matrix),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),offset=positions.length/3;
  positions.push(...position.array);normals.push(...normal.array);
  for(let i=0;i<position.count;i++)colors.push(part.material.color.r,part.material.color.g,part.material.color.b);
  if(geometry.index)for(const i of geometry.index.array)indices.push(i+offset);else for(let i=0;i<position.count;i++)indices.push(i+offset);
  geometry.dispose();
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}
function car(type='Car',color='#d9ddcb'){const key=type+color;if(carModels.has(key))return carFromModel(carModels.get(key),type);const g=new THREE.Group(),bike=type==='Two-wheeler',truck=type==='Truck',ambulance=type==='Ambulance';const w=bike?.55:truck?2:1.65,l=bike?1.8:truck?5.3:3.4;meshBox(g,0,.65,0,w,.7,l,ambulance?'#e8e7da':color);meshBox(g,0,truck?1.55:1.25,truck?-.7:-.2,w*.86,truck?1.5:.65,truck?3.1:l*.57,ambulance?'#edece2':color);if(!bike){meshBox(g,0,1.3,truck?1.6:1.0,w*.8,.48,.04,'#4b7889');meshBox(g,w*.505,1.25,-.15,.025,.45,l*.45,'#527e8a');meshBox(g,-w*.505,1.25,-.15,.025,.45,l*.45,'#527e8a')}for(const xx of bike?[0]:[-w/2,w/2])for(const zz of [-l*.31,l*.31])meshBox(g,xx,.35,zz,bike?.18:.22,.45,.6,'#1c2d35');if(bike){meshBox(g,0,1.25,-.2,.4,.65,.45,'#4c6064');const head=new THREE.Mesh(geos.sphere,mat('#d0c7a9'));head.scale.set(.23,.23,.23);head.position.set(0,1.75,-.2);g.add(head)}else{for(const xx of [-w*.32,w*.32])meshBox(g,xx,.7,l/2+.02,.27,.16,.04,'#ffdf9a',true);meshBox(g,0,.6,-l/2-.02,w*.7,.13,.04,'#ff8f78',true)}if(ambulance){meshBox(g,0,1.65,0,1.4,.18,.6,'#426672');g.userData.flash=meshBox(g,-.38,1.79,0,.5,.15,.4,'#80d5ff',true);meshBox(g,.38,1.79,0,.5,.15,.4,'#ff6c65',true);meshBox(g,w/2+.02,1.2,0,.04,.75,.23,'#c96151');meshBox(g,w/2+.04,1.2,0,.04,.23,.75,'#c96151')}const model={body:combineCarParts(g,false),lights:combineCarParts(g,true),flash:g.userData.flash};carModels.set(key,model);return carFromModel(model,type)}
function spawn(type='Car',routeId='residential-0',p=-60,options={}){
 const v=spawnVehicle(traffic,type,routeId,{p,...options});v.mesh=car(type,['#d1dfd6','#b9c6ce','#ddb27e','#7baca7','#d58d7e'][Math.floor(random()*5)]);world.add(v.mesh);positionVehicle(v);return v;
}
function positionVehicle(v){const pos=vehiclePosition(v);v.mesh.position.set(pos.x,.16,pos.z);v.mesh.rotation.y=v.route.angle;v.mesh.visible=v.parked||vehicleOnRoad(v)}
function ambient(){for(const route of traffic.routes){const j=traffic.junctions.find(j=>j.id===route.junction);if(!j.signalized&&route.approach!==2)continue;for(let i=0;i<j.demand;i++)spawn(i%4===3?'Truck':i%5===4?'Two-wheeler':'Car',route.id,(j.signalized?-25:-56)-i*8)}}
function surroundings(){
 box(0,-1.05,0,260,1.6,220,'#3b584c');box(0,-.18,0,244,.2,202,'#667970');
 const onRoad=(x,z)=>DISTRICTS.some(j=>(Math.abs(x-j.x)<13&&Math.abs(z-j.z)<78)||(Math.abs(z-j.z)<13&&Math.abs(x-j.x)<78));
 for(let x=-108;x<=108;x+=18)for(let z=-87;z<=87;z+=18){
  if(Math.abs(x+48)<74&&Math.abs(z+30)<74||onRoad(x,z)||Math.abs(x)<30&&z>40||Math.abs(x)<15&&Math.abs(z)<35)continue;
  if(x<0)house(x,z,x<-48?Math.PI/2:-Math.PI/2);else tower(x,z,8+random()*3,8+random()*3,(Math.abs(x-48)<36&&Math.abs(z-30)<36)?6+random()*3:12+random()*14);
 }
 residentialHomes();
 for(const j of DISTRICTS){road(0,j.roadWidth,132,j.x,j.z);road(Math.PI/2,j.roadWidth,132,j.x,j.z);
  if(j.signalized)for(let a=0;a<4;a++){crosswalk(a*Math.PI/2,j);signal(j,a)}
  for(let p=-58;p<=58;p+=23){if(Math.abs(p)<14)continue;if(j.signalized){tree(j.x+10,j.z+p,.75);tree(j.x-10,j.z+p,.7)}lamp(j.x+(j.signalized?7.5:3.5),j.z+p);}
  districtLabels.set(j.id,label(j.signalized?'CENTRAL JUNCTION · N/S GREEN':'RESIDENTIAL · GREEN / CLEAR',j.x,j.signalized?10:2,j.z));
 }
 box(0,.08,0,18,.2,52,'#547b61');box(0,.22,0,2,.05,52,'#b7b7a0');for(let z=-20;z<=20;z+=10){tree(-5,z,.9);tree(5,z,.8)}
 for(let i=0;i<10;i++)tower(-90+i*22,-110,9+random()*6,10,20+random()*20);
}
function garage(){const before=world.children.length,firstLabel=worldLabels.length;box(0,.35,0,43,.5,33,'#8b9b91');box(0,.65,0,40,.2,30,'#56666a');for(let x=-20;x<=20;x+=10)for(const z of [-15,15])box(x,4,z,.65,7,.65,'#a9b7ac');box(0,6.6,15,42,1.3,.7,'#a6b5a9');box(0,6.6,-15,42,1.3,.7,'#a6b5a9');box(-20,6.6,0,.7,1.3,30,'#a6b5a9');box(20,6.6,0,.7,1.3,30,'#a6b5a9');const occupied=new Set([0,1,3,4,6,7,10,11,13,14,16,18,20,21,22,24,26,28]);for(let row=0;row<3;row++){const z=-10+row*10;for(let i=0;i<10;i++){const x=-16+i*3.55,index=row*10+i;box(x,.78,z,3.2,.03,5.3,occupied.has(index)?'#6c7975':'#8ebda2');box(x-1.65,.8,z,.07,.02,5.3,'#d4dccb');box(x,.8,z-2.65,3.3,.02,.07,'#d4dccb');let m=null;if(occupied.has(index)){m=car('Car',['#bbccc4','#dab178','#82a7a6'][i%3]);m.position.set(x,.9,z);m.scale.setScalar(.85);world.add(m)}slots.push({x,z,index,occupied:occupied.has(index),mesh:m})}box(18,3.8,z,.4,.3,.5,'#c4d3c9');box(18,3.8,z-.3,.2,.2,.2,'#85d7db',0,true);label('CAM 0'+(row+1)+' · ZONE '+String.fromCharCode(65+row),15,5,z,'green');ring(12,z,'#8dccbf',5)}roof=new THREE.Mesh(geos.box,mat('#a7b8ae'));roof.position.set(0,7.8,0);roof.scale.set(43,.6,33);roof.visible=false;world.add(roof);box(-19,3.5,0,.35,6,30,'#7e9893');label('CENTRAL PARK & RIDE',-4,9,15);box(0,.12,21,6,.15,12,'#394b55');lamp(5,21);for(let i=before;i<world.children.length;i++)world.children[i].position.z+=65;for(let i=firstLabel;i<worldLabels.length;i++)worldLabels[i].position.z+=65;for(const slot of slots)slot.z+=65;const pending=[...batches.values()];for(const batch of pending)for(const item of batch.items)item[2]+=65;}
function resetView(mode=viewMode){
 viewMode=mode;const mobile=innerWidth<701;
 let target=mode==='residential'?DISTRICTS[0]:mode==='busy'?DISTRICTS[1]:mode==='parking'?{x:0,z:65}:{x:0,z:0};
 const overview=mode==='overview',residential=mode==='residential';
 controls.target.set(target.x,mobile?(residential?-5:-10):0,target.z);
 camera.position.set(target.x+(overview?137:residential?33:66),overview?145:residential?38:70,target.z+(overview?161:residential?42:82));
 camera.zoom=mobile?(overview?.66:.87):overview?.93:1;camera.updateProjectionMatrix();controls.update();
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',b.dataset.view===mode);
 if(overview){$('scene-title').innerHTML='One connected city.<br>Four smart sensors.';$('scene-description').innerHTML='Real-time IoT sensing for safer, smoother transport.<br>Pick a sensor below to see it in action.'}
 else{$('scene-title').innerHTML=config[current].title;$('scene-description').innerHTML=config[current].description}
}
function buildScene(){
 seed=17;world.clear();for(const m of pulses){m.geometry.dispose();m.material.dispose()}worldLabels.forEach(l=>l.el.remove());
 traffic=createTraffic();vehicles=traffic.vehicles;signals=[];beacons=[];pulses=[];worldLabels=[];slots=[];batches.clear();districtLabels.clear();focusCar=null;ambulanceCar=null;fault=false;priority=null;echoUntil=0;forecastActive=false;roofVisible=false;counts={'Two-wheeler':0,Car:0,Truck:0};lastSignature=null;
 surroundings();
 const residential=DISTRICTS[0],busy=DISTRICTS[1];
 for(const [a,[x,z]] of [[3.2,-8.5],[-8.5,-3.2],[-3.2,8.5],[8.5,3.2]].entries())beacon(residential.x+x,residential.z+z,a);
 sensorLabel=label('LOW WARNING POSTS · GREEN',residential.x+3.2,1.8,residential.z-8.5,'green');
 for(const x of [-8,8]){box(busy.x+x,3,busy.z-22,.12,6,.12,'#9caeaa');box(busy.x+x,6,busy.z-22,.5,.35,.4,'#8ed3d7',0,true);label(x<0?'ACOUSTIC A':'ACOUSTIC B',busy.x+x,7,busy.z-22);ring(busy.x+x,busy.z-22,'#8ed0d9',3)}
 priorityRoute=new THREE.Mesh(geos.box,new THREE.MeshBasicMaterial({color:'#b6f5a0',transparent:true,opacity:.24,depthWrite:false}));priorityRoute.position.set(busy.x+2.7,.26,busy.z);priorityRoute.scale.set(3,.025,124);priorityRoute.visible=false;world.add(priorityRoute);
 for(const direction of [-1,1]){box(busy.x+direction*2.7,.24,busy.z+direction*3,2.9,.05,2,'#81d2cc',0,true);box(busy.x+direction*2.7,.28,busy.z+direction*3,2.3,.08,.7,'#243e49')}
 label('MAGNETOMETER · TS-01',busy.x+8,4,busy.z+3,'green');
 flush();garage();flush();ambient();renderPanel();resetView();updateTrafficVisuals();
}
function updateTrafficVisuals(){
 const colors=['#ff493c','#ffc247','#8cfa8c'];
 for(const s of signals){const j=traffic.junctions.find(j=>j.id===s.junction),state=trafficLight(j,s.approach);s.lamps.forEach((pair,i)=>pair.forEach(l=>l.material=mat(['red','amber','green'][i]===state?colors[i]:'#25363c',['red','amber','green'][i]===state)))}
 for(const j of traffic.junctions){if(!j.signalized)continue;const label=districtLabels.get(j.id);const phase=j.stage==='priority'?'AMBULANCE GREEN':j.stage==='clearing'?'ALL RED · CLEARANCE':(j.axis===0?'N/S ':'E/W ')+j.stage.toUpperCase();label.el.querySelector('span').textContent=(j.id==='busy'?'CENTRAL':'RESIDENTIAL')+' · '+phase;label.el.classList.toggle('amber',j.stage==='clearing'||j.stage==='amber')}
 const queued=vehicles.filter(v=>vehicleOnRoad(v)&&v.velocity<.2&&!v.parked).length;
 $('traffic-summary').textContent='4 traffic signals · 4 warning posts · '+queued+' waiting';
}
function status(title,detail,warning=false){if($('status-title').textContent!==title)$('status-title').textContent=title;if($('status-detail').textContent!==detail)$('status-detail').textContent=detail;document.querySelector('.status').classList.toggle('warning',warning);document.querySelector('.status').classList.remove('danger')}
function secondary(text,fn){const b=document.createElement('button');b.textContent=text;b.addEventListener('click',fn);$('secondary').appendChild(b);return b}
function renderPanel(){const c=config[current];$('district').textContent=c.district;$('scene-title').innerHTML=c.title;$('scene-description').innerHTML=c.description;$('feature-title').textContent=c.name;$('feature-copy').textContent=c.copy;$('location-name').textContent=c.location;$('location-type').textContent=c.type;$('trigger-label').textContent=c.action;$('panel-note').textContent=c.note;$('extra').innerHTML='';$('secondary').innerHTML='';$('trigger').disabled=false;
 if(current==='s1'){status('Watching the junction','Approaching vehicles activate cross-street warnings.');secondary('Departing car',()=>sendS1(false));secondary('Parked car',()=>{clearFocus();focusCar=spawn('Car','residential-0',-24,{forced:true});focusCar.parked=true;focusCar.p=-24;focusCar.lane=3.6;positionVehicle(focusCar);status('Parked vehicle ignored','No closing motion detected. Warnings stay in standby.')});secondary('Sensor fault',()=>{fault=!fault;status(fault?'Fail-safe warning active':'Sensor restored',fault?'Independent watchdog keeps every post red.':'Directional sensing is back online.',fault)})}
 if(current==='s2'){status('Normal signal cycle','Four approaches alternate with amber and all-red clearance.');$('trigger').disabled=!!traffic.junctions[1].priority;secondary('Test reflected siren',()=>{echoUntil=time+5;status('Reflected siren rejected','Acoustic timing and pitch do not indicate an approach.')});secondary('Reset traffic',()=>buildScene())}
 if(current==='s3'){$('extra').innerHTML='<div class="stats"><div class="stat"><strong id="count-bike">'+counts['Two-wheeler']+'</strong><span>Two-wheelers</span></div><div class="stat"><strong id="count-car">'+counts.Car+'</strong><span>Cars</span></div><div class="stat"><strong id="count-truck">'+counts.Truck+'</strong><span>Trucks</span></div></div><svg class="waveform" viewBox="0 0 260 52" role="img" aria-label="Simulated magnetic waveform"><path class="wave-grid" d="M0 26h260M65 0v52M130 0v52M195 0v52"/><path id="wave" d="M0 26h260"/></svg><div class="wave-caption"><span id="wave-type">Awaiting a signature</span><span>ΔB / time</span></div>';for(const t of ['Two-wheeler','Car','Truck']){const b=secondary(t,()=>{vehicleType=t;$('trigger-label').textContent='Send '+(t==='Car'?'a car':t==='Truck'?'a truck':'a two-wheeler');document.querySelectorAll('#secondary button').forEach(el=>el.style.borderColor='');b.style.borderColor='var(--accent)'});if(t===vehicleType)b.style.borderColor='var(--accent)'}status('Sensor ready','Each detected pass is counted once.');$('trigger-label').textContent='Send '+(vehicleType==='Car'?'a car':vehicleType==='Truck'?'a truck':'a two-wheeler')}
 if(current==='s5'){$('extra').innerHTML='<label class="arrival" for="eta"><span>Your arrival time</span><strong><span id="eta-label">'+eta+'</span> min from now</strong></label><input id="eta" type="range" min="1" max="20" value="'+eta+'"><div class="parking-stats"><div><span>FREE RIGHT NOW</span><strong id="free-now">12 / 30</strong></div><div class="predicted"><span>FREE ON ARRIVAL</span><strong id="free-arrival">8 / 30</strong></div></div><div class="forecast-note" id="forecast-note"></div>';$('eta').addEventListener('input',e=>{eta=Number(e.target.value);updateForecast()});secondary('Show roof',()=>{roofVisible=!roofVisible;roof.visible=roofVisible;document.querySelector('#secondary button').textContent=roofVisible?'Cutaway view':'Show roof';worldLabels.forEach(l=>{if(l.el.textContent.includes('CAM'))l.el.style.visibility=roofVisible?'hidden':''})});secondary('Reset forecast',()=>{forecastActive=false;slots.forEach(s=>{if(s.mesh)s.mesh.visible=true;if(s.arrivalMesh)s.arrivalMesh.visible=false});renderPanel()});updateForecast();status('3 camera zones online','18 occupied · 12 free now. Forecast uses synthetic movement.')}
}
function clearFocus(){if(focusCar){world.remove(focusCar.mesh);vehicles.splice(vehicles.indexOf(focusCar),1);focusCar=null}}
function sendS1(approach=true){clearFocus();focusCar=spawn('Car',approach?'residential-0':'residential-2',approach?-56:24,{forced:true,departing:!approach});focusCar.outgoing=!approach;status(approach?'Vehicle approaching':'Departing vehicle ignored',approach?'Its post stays green; the other three turn red. Vehicles yield before crossing.':'Distance is increasing. The vehicle stays in its correct lane.')}
$('trigger').addEventListener('click',()=>{
 if(paused)togglePause();
 if(current==='s1')sendS1();
 if(current==='s2'){
  if(traffic.junctions[1].priority)return;
  ambulanceCar=spawn('Ambulance','busy-0',-60,{forced:true});requestAmbulance(traffic,ambulanceCar);priority='clearing';priorityStart=time;$('trigger').disabled=true;status('Approaching siren located','North approach · all red until committed traffic has cleared.',true);
 }
 if(current==='s3'){spawn(vehicleType,'busy-0',-52,{forced:true});status('Vehicle joining sensor lane','The vehicle queues safely and is counted when it passes the sensor.')}
 if(current==='s5'){forecastActive=true;priorityStart=time;slots.forEach(s=>{if(s.arrivalMesh)s.arrivalMesh.visible=false;if(s.mesh)s.mesh.visible=true});updateForecast();status('Forecast playing','Amber cars are expected arrivals; departing cars release their bays.');$('trigger-label').textContent='Replay arrival forecast'}
});
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{
 const view=b.dataset.view;
 if(view==='residential'||view==='busy'){const scene=view==='residential'?'s1':'s2';if(location.hash!==('#'+scene))location.hash=scene;else{renderPanel();resetView(view)}}
 else resetView('overview');
});
function updateForecast(){if(forecastActive)priorityStart=time;const f=forecastParking(eta);$('eta-label').textContent=eta;$('free-now').textContent=f.now+' / 30';$('free-arrival').textContent=f.predicted+' / 30';$('forecast-note').textContent=f.arrivals+' expected arrivals − '+f.departures+' departures. A “free now” baseline would overestimate availability by '+(f.now-f.predicted)+' spaces.';}
function choose(id){if(!config[id])id='s1';current=id;document.querySelectorAll('[data-scene]').forEach(b=>{const active=b.dataset.scene===id;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active)});renderPanel();resetView(id==='s1'?'residential':id==='s5'?'parking':'busy');}
for(const b of document.querySelectorAll('[data-scene]'))b.addEventListener('click',()=>{if(location.hash==='#'+b.dataset.scene)choose(b.dataset.scene);else location.hash=b.dataset.scene});addEventListener('hashchange',()=>choose(location.hash.slice(1)));
function togglePause(){paused=!paused;$('pause').setAttribute('aria-label',paused?'Resume simulation':'Pause simulation');$('pause').innerHTML=paused?'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';$('running-label').textContent=paused?'Sensors paused':'Sensors live';document.querySelector('.live i').style.background=paused?'var(--amber)':'var(--green)'}
$('pause').addEventListener('click',togglePause);$('speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?.5:1;$('speed').textContent=speed+'×'});
function zoom(factor){const direction=camera.position.clone().sub(controls.target);const distance=THREE.MathUtils.clamp(direction.length()*factor,controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(direction.setLength(distance));controls.update()}
$('zoom-in').addEventListener('click',()=>zoom(.85));$('zoom-out').addEventListener('click',()=>zoom(1.18));$('reset-view').addEventListener('click',()=>resetView());$('help').addEventListener('click',()=>$('help-dialog').showModal());
addEventListener('keydown',e=>{if(e.target.matches('input,button')||$('help-dialog').open)return;if(e.code==='Space'){e.preventDefault();togglePause()}if(e.key==='+')zoom(.85);if(e.key==='-')zoom(1.18);if(e.key==='0')resetView()});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
function signature(v){const values=v.type==='Two-wheeler'?[.25,.7]:v.type==='Truck'?[1,2]:[.65,1.2];const classified=classifySignature(...values);counts[classified]++;lastSignature={type:classified,at:time,peak:values[0],width:values[1]};if(current!=='s3')return;$('count-bike').textContent=counts['Two-wheeler'];$('count-car').textContent=counts.Car;$('count-truck').textContent=counts.Truck;$('wave-type').textContent=classified+' detected';const path=[];for(let i=0;i<=130;i++){const x=i*2,t=(i-65)/(values[1]*9);const y=26-Math.sin(t*2.2)*Math.exp(-t*t*.3)*values[0]*22;path.push((i?'L':'M')+x+' '+y.toFixed(2))}$('wave').setAttribute('d',path.join(' '));status(classified+' signature detected',Object.values(counts).reduce((a,b)=>a+b,0)+' vehicles counted · waveform classification illustrated.')}
function tick(dt){
 time+=dt;
 const before=new Map(vehicles.map(v=>[v.id,v.p]));
 for(const v of stepTraffic(traffic,dt)){world.remove(v.mesh);if(v===focusCar)focusCar=null;if(v===ambulanceCar)ambulanceCar=null}
 for(const v of vehicles){
  positionVehicle(v);
  if(v.route.junction==='busy'&&v.route.axis===0&&!v.counted&&before.get(v.id)<3&&v.p>=3){v.counted=true;signature(v)}
  if(v.type==='Ambulance')v.mesh.userData.flash.visible=Math.floor(time*8)%2===0;
 }
 const j=traffic.junctions[1],nextPriority=j.priority?(j.stage==='priority'?'active':'clearing'):null;
 if(priority!==nextPriority&&current==='s2'){
  if(nextPriority==='active')status('Green held for ambulance','Vehicles ahead clear first. Every conflicting approach stays red.');
  else if(priority==='active'&&!nextPriority)status('Ambulance clear','All-red clearance, then the normal coordinated cycle resumes.');
 }
 priority=nextPriority;if(current==='s2')$('trigger').disabled=!!j.priority;priorityRoute.visible=j.stage==='priority';
 const warnings=residentialWarnings(traffic,fault),red=warnings.includes('red'),approach=warnings.indexOf('green'),direction=['North','West','South','East'][approach];
 sensorLabel.el.querySelector('span').textContent=fault?'FAIL-SAFE · ALL RED':red?direction.toUpperCase()+' GREEN · OTHER SIDES RED':'NO INCOMING VEHICLE · ALL GREEN';
 sensorLabel.el.classList.toggle('red',fault);sensorLabel.el.classList.toggle('green',!fault);sensorLabel.position.copy(beacons[approach<0?0:approach].position);sensorLabel.position.y=2.1;
 for(const b of beacons){b.material=postMaterials[warnings[b.userData.approach]];b.visible=true}
 const residentialLabel=districtLabels.get('residential');residentialLabel.el.querySelector('span').textContent=red?'RESIDENTIAL · CROSS-TRAFFIC WARNING':'RESIDENTIAL · ALL GREEN';residentialLabel.el.classList.toggle('red',red);residentialLabel.el.classList.toggle('green',!red);
 if(current==='s1'){
  if(fault)status('All red · fail-safe warning','The independent watchdog keeps all posts red.',true);
  else if(red)status(direction+' approach stays green','The other three posts are red until this vehicle clears the junction.',true);
  else status('All green · no incoming vehicle','The crossing is clear. Parked and departing vehicles are ignored.');
  document.querySelector('.status').classList.toggle('danger',red);
 }
 if(echoUntil&&time>echoUntil){echoUntil=0;if(current==='s2'&&!j.priority)status('Normal signal cycle','Reflected siren rejected. Signal cycle unchanged.')}
 updateTrafficVisuals();
 if(current==='s5'&&forecastActive){const f=forecastParking(eta),progress=Math.min(1,(time-priorityStart)/6),plan=parkingSchedule(slots.map(s=>s.occupied),eta),departing=plan.departing.map(i=>slots[i]),arriving=plan.arriving.map(i=>slots[i]);slots.forEach(s=>{const di=departing.indexOf(s),ai=arriving.indexOf(s);if(s.mesh)s.mesh.visible=di<0||progress<.4*(di+1)/(departing.length+1);const arrived=ai>=0&&progress>.4+.6*(ai+1)/(arriving.length+1);if(arrived&&!s.arrivalMesh){s.arrivalMesh=car('Car','#ddbd7e');s.arrivalMesh.scale.setScalar(.85);s.arrivalMesh.position.set(s.x,.9,s.z);world.add(s.arrivalMesh)}if(s.arrivalMesh)s.arrivalMesh.visible=arrived});if(progress===1)status('Arrival-time view · '+eta+' min',f.predicted+' spaces forecast free, compared with '+f.now+' free now.');}
}
const projected=new THREE.Vector3();let previous=performance.now();function animate(){const now=performance.now();requestAnimationFrame(animate);const dt=Math.max(0,Math.min((now-previous)/1000,.05));previous=now;if(!paused)tick(dt*speed);controls.update();pulses.forEach((p,i)=>{const s=1+Math.sin(time*1.6-i)*.06;p.scale.set(s,s,s);p.material.opacity=.28+Math.sin(time*2-i)*.12});for(const l of worldLabels){projected.copy(l.position).project(camera);const x=(projected.x*.5+.5)*innerWidth,y=(-projected.y*.5+.5)*innerHeight;l.el.style.left=x+'px';l.el.style.top=y+'px';l.el.style.display=projected.z>1||x<0||x>innerWidth||y<(innerWidth<701?175:90)||y>innerHeight-115?'none':''}renderer.render(scene,camera)}
buildScene();choose(location.hash.slice(1)||'s1');if(!location.hash)resetView('overview');if(paused){paused=false;togglePause()}$('loading').classList.add('loaded');requestAnimationFrame(animate);
