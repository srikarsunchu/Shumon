import * as THREE from 'three';
import {createSamurai} from './templeSamurai.js';
import {terrainHeight} from './templeLandscape.js';

export const PALACE={floor:7,front:-39.9,back:-48.1,halfWidth:6.8};
export function buildPalace(scene,world) {
  const hall=world.temple,remove=[];
  // Replace the known solid ground-storey blocks; retain the authored roofs and upper gallery.
  hall.traverse(o=>{
    const p=o.geometry?.parameters;if(!p)return;
    if((p.width===13.6&&p.height===5)||(p.width===14.6&&p.height===.4)||(p.width===7.6&&p.height===3.4)) remove.push(o);
    if(o.geometry.type==='PlaneGeometry' && Math.abs(o.position.x)<.01 && o.position.y<12 && o.position.z>-40) remove.push(o);
  });
  for(const o of remove){o.removeFromParent();o.geometry.dispose();}
  const wood=new THREE.MeshStandardMaterial({color:0x30241b,roughness:.85});
  const plaster=new THREE.MeshStandardMaterial({color:0x8b8067,roughness:1});
  const beam=new THREE.MeshStandardMaterial({color:0x211713,roughness:.8});
  const tatami=new THREE.MeshStandardMaterial({color:0x716748,roughness:1});
  const border=new THREE.MeshStandardMaterial({color:0x242b23,roughness:.9});
  const brass=new THREE.MeshStandardMaterial({color:0x9c7d3d,metalness:.65,roughness:.45});
  const ink=new THREE.MeshStandardMaterial({color:0x171a1a,roughness:.8});
  const paper=new THREE.MeshStandardMaterial({color:0xc6af80,roughness:.9,emissive:0x251808});
  if(typeof document!=='undefined' && typeof document.createElement==='function') {
    function surface(base,stroke,woven){const c=document.createElement('canvas');c.width=c.height=256;const cx=c.getContext('2d');cx.fillStyle=base;cx.fillRect(0,0,256,256);cx.strokeStyle=stroke;cx.lineWidth=1;for(let i=0;i<128;i++){cx.beginPath();const y=i*2;cx.moveTo(0,y);for(let x=0;x<=256;x+=16)cx.lineTo(x,y+(woven?((x/16+i)%2)*.5:Math.sin(x*.04+i)*1.4));cx.stroke();}const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;}
    wood.map=surface('#b0a28c','rgba(34,23,17,.16)',false);
    tatami.map=surface('#d6caa0','rgba(55,57,30,.3)',true);
  }
  const root=new THREE.Group();root.name='Palace interior';scene.add(root);
  function box(name,w,h,d,x,y,z,material=wood,solid=true,parent=root){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.name=name;m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;m.userData.noCollision=!solid;parent.add(m);return m;}
  const F=PALACE.floor;
  // A low threshold is within the character controller's step height.
  box('Hall timber floor',13.6,.12,8.4,0,F+.06,-44);
  box('Hall ceiling',13.6,.18,8.4,0,F+5,-44,beam);
  box('Rear plaster wall',13.6,5,.2,0,F+2.5,-48.1,plaster);
  for(const side of [-1,1]) {
    box('Front wall beside doors',5.5,5,.22,side*4.05,F+2.5,-39.9,wood);

    // Side passages lead to the two smaller rooms.
    box('Hall side rear',.2,5,4.1,side*6.8,F+2.5,-46.05,plaster);
    box('Hall side front',.2,5,.5,side*6.8,F+2.5,-40.15,plaster);
    box('Side passage lintel',.22,1.8,3.6,side*6.8,F+4.1,-42.2,beam);
    box('Wing timber floor',7.6,.12,5.2,side*10.6,F+.06,-42.6);
    box('Wing ceiling',7.6,.16,5.2,side*10.6,F+3.35,-42.6,beam);
    box('Wing outer wall',.2,3.4,5.2,side*14.4,F+1.7,-42.6,plaster);
    for(const z of [-45.2,-40])box('Wing wall',7.6,3.4,.2,side*10.6,F+1.7,z,wood);
    for(let k=0;k<4;k++)box('Wall post',.14,3.35,.18,side*(7.4+k*2),F+1.7,-45.05,beam);
  }
  box('Door lintel',2.6,1.6,.28,0,F+4.2,-39.9,beam);
  // Reception hall: bordered tatami islands leave a timber route to both side rooms.
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
    const x=(col-1.5)*1.5,z=-42.2-row*1.85;
    box('Tatami border',1.48,.035,1.82,x,F+.14,z,border,false);
    box('Woven tatami',1.39,.04,1.73,x,F+.16,z,tatami,false);
    // Fine reeds have low contrast and are merged by using a shared procedural material below.
  }
  for(let i=0;i<7;i++)box('Ceiling crossbeam',.2,.25,8.1,(i-3)*2,F+4.85,-44,beam,false);
  box('Raised rear alcove',5.1,.2,1.25,0,F+.22,-47.2);
  box('Alcove backing',5,3,.12,0,F+1.8,-47.94,plaster);
  box('Hanging scroll',1.2,2.1,.03,0,F+2.1,-47.83,paper,false);
  // An ink landscape, not invented calligraphy: mountain ridges and a vermilion sun.
  const mountain=new THREE.Shape();mountain.moveTo(-.47,0);mountain.lineTo(-.15,.65);mountain.lineTo(.06,.24);mountain.lineTo(.24,.44);mountain.lineTo(.48,0);mountain.closePath();
  const art=new THREE.Mesh(new THREE.ShapeGeometry(mountain),ink);art.position.set(0,F+1.75,-47.80);art.userData.noCollision=true;root.add(art);
  for(const y of [F+1.03,F+3.17])box('Scroll roller',1.32,.055,.055,0,y,-47.8,beam,false);
  function table(x,z,w=1.8){box('Low writing table',w,.12,.85,x,F+.65,z);for(const sx of [-1,1])for(const sz of [-1,1])box('Table leg',.08,.52,.08,x+sx*(w/2-.12),F+.35,z+sz*.3);}
  table(10.5,-43.6,2.5);
  for(let i=0;i<3;i++)box('Manuscript sheets',.45,.014,.6,9.8+i*.5,F+.725,-43.6,paper,false);
  box('Inkstone',.23,.05,.15,11.45,F+.74,-43.55,ink,false);
  box('Brush',.025,.025,.38,11.1,F+.75,-43.6,beam,false);
  box('Writing cushion',.7,.12,.7,10.5,F+.2,-42.55,border,false);
  for(let i=0;i<3;i++){box('Manuscript shelf',.7,.1,3,13.7,F+.6+i*.65,-43,wood);for(let j=0;j<5;j++){
    const z=-44+j*.48,y=F+.69+i*.65;
    box('Manuscript pages',.4,.055,.25,13.65,y,z,paper,false);
    box('Cloth book cover',.42,.014,.27,13.65,y+.035,z,border,false);
    box('Book binding',.025,.065,.27,13.45,y,z,border,false);
  }}
  // Armour room: stands and lacquered equipment chests, with a clear circulation route.
  for(const x of [-9,-12]){
    box('Armour stand foot',1,.12,.7,x,F+.18,-44.4,beam);box('Armour stand',.14,1.8,.14,x,F+1.1,-44.4,beam);
    const display=createSamurai({hat:false,lights:false,palette:'iron'});
    display.update(0,{speed:0,run:0,phase:0,drawn:false,swing:-1,time:0});
    display.group.name='Displayed lamellar armour';display.group.position.set(x,F+.18,-44.4);
    for(const part of [...display.skinParts,...display.hairParts])part.visible=false;
    display.katana.visible=display.saya.visible=display.sheathedHilt.visible=false;
    display.group.traverse(o=>{o.userData.noCollision=true;});root.add(display.group);
    const helmet=new THREE.Mesh(new THREE.SphereGeometry(.18,14,8,0,Math.PI*2,0,Math.PI/2),ink);helmet.position.set(x,F+1.85,-44.4);helmet.userData.noCollision=true;root.add(helmet);
    box('Equipment chest',1.35,.62,.7,x,F+.43,-41.05,wood);
    for(const side of [-1,1])box('Chest band',.06,.64,.72,x+side*.42,F+.44,-41.05,brass,false);
  }
  // The prize uses the same curved, bevelled blade as the playable sword.
  const swordRig=createSamurai({hat:false,lights:false});
  const prize=swordRig.katana.clone(true);prize.name='The master’s sword';prize.visible=true;
  prize.position.set(.48,F+1.18,-46.5);prize.rotation.set(0,Math.PI/2,0);prize.scale.setScalar(1.35);
  prize.traverse(o=>{o.userData.noCollision=true;});root.add(prize);
  // Release the unused mannequin; the displayed sword retains its own resources.
  const keptGeo=new Set(),keptMat=new Set();prize.traverse(o=>{if(o.isMesh){keptGeo.add(o.geometry);keptMat.add(o.material);}});
  for(const g of new Set(swordRig.meshes.map(m=>m.geometry)))if(!keptGeo.has(g))g.dispose();
  for(const m of new Set(swordRig.meshes.map(m=>m.material)))if(!keptMat.has(m))m.dispose();
  box('Sword display foot',1.7,.1,.5,0,F+.32,-46.5,ink);
  for(const x of [-.45,.45]){box('Sword stand upright',.07,.78,.12,x,F+.74,-46.5,ink,false);box('Sword cradle',.2,.08,.18,x,F+1.09,-46.5,brass,false);}
  const prizeLight=new THREE.PointLight(0xffdfae,1.1,4,2);prizeLight.position.set(0,F+2.2,-46);root.add(prizeLight);
  const bag=new THREE.Group();bag.name='Already packed travelling bag';bag.position.set(4.6,F+.35,-46);root.add(bag);
  box('Cloth travelling bundle',.55,.38,.4,0,0,0,border,false,bag);
  box('Bundle tie',.06,.42,.42,0,0,0,beam,false,bag);
  box('Master’s bench',.85,.1,.65,3.7,F+.48,-46,wood,false);
  for(const x of [3.4,4])box('Bench foot',.1,.42,.55,x,F+.25,-46,beam,false);
  let story='approach';
  // Two substantial leaves share a single doorway; open before the capsule reaches them.
  const doors=[];
  for(const side of [-1,1]){
    const hinge=new THREE.Group();hinge.name=side<0?'Left front door':'Right front door';hinge.position.set(side*1.3,F+.12,-39.72);root.add(hinge);
    box('Door leaf',1.28,3.15,.14,-side*.64,1.575,0,wood,false,hinge);
    for(const y of [.3,1.6,2.85])box('Door iron strap',1.27,.075,.18,-side*.64,y,.02,ink,false,hinge);
    for(let i=0;i<6;i++)box('Door plank seam',.018,3.08,.008,-side*(.1+i*.2),1.575,.077,beam,false,hinge);
    const pull=new THREE.Mesh(new THREE.TorusGeometry(.095,.018,6,16),brass);pull.position.set(-side*1.05,1.5,.13);hinge.add(pull);pull.userData.noCollision=true;
    doors.push({hinge,side});
  }
  // Timber dado and alcove joinery bring the large plaster surfaces to human scale.
  box('Reception dado',13.2,.85,.08,0,F+.57,-47.94,wood,false);
  for(const x of [-6.65,-3,3,6.65])box('Reception wall post',.14,4.8,.16,x,F+2.5,-47.91,beam,false);
  table(-1.65,-46.7,1.6);
  box('Tea tray',.8,.035,.45,-1.65,F+.73,-46.7,beam,false);
  for(const x of [-1.85,-1.45]) {const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.09,.055,.08,14),ink);bowl.position.set(x,F+.79,-46.7);bowl.userData.noCollision=true;root.add(bowl);}
  function lantern(x,z,y=F+2.5){box('Lantern cap',.52,.08,.52,x,y+.38,z,beam,false);box('Lantern shade',.4,.65,.4,x,y,z,paper,false);box('Lantern base',.52,.08,.52,x,y-.38,z,beam,false);const light=new THREE.PointLight(0xffc58d,.85,8,2);light.position.set(x,y,z);root.add(light);}
  lantern(-4.6,-44);lantern(4.6,-44);lantern(-10.7,-42);lantern(10.7,-42);lantern(-3,-46.5);
  // The woodland path is blended directly into the landscape soil material.
  for(const [x,z] of [[-3,75],[3.5,62],[-3,49],[3.5,36],[-3,23]]) {const y=terrainHeight(x,z);box('Path marker',.2,1.1,.2,x,y+.55,z,beam);box('Path lantern',.32,.4,.32,x,y+1.12,z,paper,false);for(const offset of [-.24,.24])box('Path lantern cap',.45,.07,.45,x,y+1.12+offset,z,beam,false);for(const dx of [-.17,.17])for(const dz of [-.17,.17])box('Lantern timber frame',.035,.42,.035,x+dx,y+1.12,z+dz,beam,false);const l=new THREE.PointLight(0xffba78,.65,5,2);l.position.set(x,y+1.2,z);scene.add(l);}
  return {doors,setClaimed(v){prize.visible=!v;if(!v){root.attach(bag);bag.position.set(4.6,F+.35,-46);bag.rotation.set(0,0,0);}},setStory(v){story=v;},giveBag(rig){rig.joints.leftForearm.add(bag);bag.position.set(0,-.35,0);},update(dt,player){const inside=player.y>6 && player.z<-39.9 && player.z>-48.2 && Math.abs(player.x)<14.5;if(world.rain)world.rain.visible=!inside;if(world.leaves)world.leaves.mesh.visible=!inside;if(world.hallLight && inside)world.hallLight.intensity*=.4;
    const near=Math.abs(player.x)<3 && Math.abs(player.z+39.72)<4.5 && player.y>6;for(const {hinge,side} of doors)hinge.rotation.y=THREE.MathUtils.damp(hinge.rotation.y,((near && story!=='duel') || story==='departure' || story==='challenger')?side*1.45:0,3,dt);}};
}
