import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight } from './templeLandscape.js';

// Art-directed foreground kit. All dimensions are metres; the central duel lane stays clear.
export const GROVES=[[-15,5,1.15],[-21,-2,.9],[17,10,1.05],[24,2,.9],[-18,24,1.1],[14,29,1.2],[-29,15,.9],[29,21,1.1],[-33,3,1.3],[34,-5,1.35],[-28,32,1.1],[28,34,1.2]];
export const PUDDLES=[[-4,2,1.8,.8],[4,-3,1.4,.65],[2,11,1.1,.6],[-6,-6,1.2,.7],[7,7,1.5,.6]];
export function buildEnvironment(scene,world,post,low=false) {
  let seed=821;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};
  const canvas=()=>{const c=document.createElement('canvas');c.width=c.height=1024;return c;};
  const texture=(c,color=true)=>{const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(color)t.encoding=THREE.sRGBEncoding;return t;};
  const stone=canvas(),rough=canvas(),ctx=stone.getContext('2d'),rc=rough.getContext('2d');
  ctx.fillStyle='#222a2a';ctx.fillRect(0,0,1024,1024);rc.fillStyle='#ddd';rc.fillRect(0,0,1024,1024);
  for(let row=-1;row<9;row++) for(let col=-1;col<6;col++) {
    const x=col*220+(row%2)*110,y=row*128,v=45+Math.floor(rnd()*16);
    ctx.fillStyle=`rgb(${v},${v+5},${v+6})`;ctx.beginPath();ctx.roundRect(x+3,y+3,213,121,7);ctx.fill();
    ctx.strokeStyle='rgba(150,160,150,.07)';ctx.lineWidth=2;ctx.stroke();
    for(let j=0;j<9;j++){ctx.fillStyle=`rgba(125,140,125,${.02+rnd()*.045})`;ctx.beginPath();ctx.ellipse(x+rnd()*210,y+rnd()*122,15+rnd()*45,3+rnd()*12,rnd()*3,0,Math.PI*2);ctx.fill();}
    if(rnd()<.32){ctx.strokeStyle='#303a32';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+90,y+4);ctx.lineTo(x+110,y+45);ctx.lineTo(x+83,y+77);ctx.lineTo(x+92,y+122);ctx.stroke();}
  }
  // Broad damp patches, rather than high-frequency white noise in normals.
  for(let i=0;i<35;i++){const x=rnd()*1024,y=rnd()*1024,r=30+rnd()*100,g=rc.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'#555');g.addColorStop(1,'rgba(85,85,85,0)');rc.fillStyle=g;rc.fillRect(x-r,y-r,r*2,r*2);}
  const floor=world.floorMat;
  floor.map?.dispose();floor.normalMap?.dispose();floor.roughnessMap?.dispose();
  floor.map=texture(stone);floor.map.repeat.set(28,28);floor.normalMap=null;floor.roughnessMap=texture(rough,false);floor.roughnessMap.repeat.set(10,10);
  floor.color.setHex(0x929b99);floor.roughness=.94;floor.metalness=0;floor.needsUpdate=true;
  if(post.comp){post.comp.uniforms.uGrain.value=.00012;post.comp.uniforms.uCA.value=.15;post.comp.uniforms.uBloom.value=.19;}
  world.key.shadow.bias=-.00025;world.key.shadow.normalBias=.018;
  const mat=(color,roughness=1)=>new THREE.MeshStandardMaterial({color,roughness});
  const bark=mat(0x34322c),rockMat=mat(0x121b19,.96),edge=mat(0x161d1b);
  // Smooth the authored rocks' duplicated face normals without changing their silhouettes.
  scene.traverse(o=>{if(o.isMesh && !o.isInstancedMesh && o.geometry.type==='IcosahedronGeometry'){
    o.material.roughness=.94;o.material.metalness=0;
    const old=o.geometry; const g=old.clone();g.deleteAttribute('normal');g.deleteAttribute('uv');
    o.geometry=mergeVertices(g);o.geometry.computeVertexNormals();g.dispose();old.dispose();
  }});
  const barkCanvas=canvas(),bc=barkCanvas.getContext('2d');bc.fillStyle='#555247';bc.fillRect(0,0,1024,1024);
  for(let i=0;i<140;i++){const x=rnd()*1024;bc.strokeStyle=i%3?'#393c35':'#696658';bc.lineWidth=1+rnd()*5;bc.beginPath();bc.moveTo(x,0);for(let y=0;y<=1024;y+=80)bc.lineTo(x+Math.sin(y*.01+i)*8,y);bc.stroke();}
  bark.map=texture(barkCanvas);bark.map.repeat.set(2,2);
  const kit=new THREE.Group();kit.name='Authored courtyard surroundings';scene.add(kit);
  const add=(geo,material,x,y,z,collide=false)=>{const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;m.userData.noCollision=!collide;kit.add(m);return m;};
  const branch=(a,b,r0,r1)=>{const delta=b.clone().sub(a);const m=add(new THREE.CylinderGeometry(r1,r0,delta.length(),9,3),bark,...a.clone().add(b).multiplyScalar(.5).toArray());m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;};
  const leafGeometry=new THREE.BufferGeometry();leafGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-.13,.02,.11,-.24,.01,.08,-.13,.03,.23,0,.025,.4,.13,.03,.23,.24,.01,.08,.13,.02,.11],3));leafGeometry.setIndex([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6,0,6,7]);leafGeometry.computeVertexNormals();
  const leafMat=new THREE.MeshStandardMaterial({color:0x74483c,roughness:.95,side:THREE.DoubleSide});
  const leaves=new THREE.InstancedMesh(leafGeometry,leafMat,low?4800:9600);leaves.userData.noCollision=true;leaves.castShadow=true;kit.add(leaves);const dummy=new THREE.Object3D();let leafN=0;
  function foliage(x,y,z,r,count){for(let j=0;j<count && leafN<leaves.instanceMatrix.count;j++){const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r;dummy.position.set(x+Math.cos(a)*d,y+(rnd()-.5)*.7,z+Math.sin(a)*d);dummy.rotation.set(rnd()*.8,rnd()*6,.2+rnd()*.7);dummy.scale.setScalar(.8+rnd()*.9);dummy.updateMatrix();leaves.setMatrixAt(leafN,dummy.matrix);leaves.setColorAt(leafN++,new THREE.Color().setHSL(.025+rnd()*.06,.25+rnd()*.25,.16+rnd()*.13));}}
  GROVES.forEach(([x,z,s],i)=>{
    const y=terrainHeight(x,z),base=new THREE.Vector3(x,y,z),top=new THREE.Vector3(x+(i%2?-.8:.9)*s,y+5.4*s,z+.25);
    branch(base,top,.3*s,.09*s);
    for(let k=0;k<7;k++){const a=k*2.4+i,attach=base.clone().lerp(top,.4+k*.065),tip=attach.clone().add(new THREE.Vector3(Math.cos(a)*(1.5+k*.15)*s,1.2*s,Math.sin(a)*2*s));branch(attach,tip,.085*s,.012);foliage(tip.x,tip.y,tip.z,1.35*s,low?45:90);}
    for(let k=0;k<5;k++){const a=k*1.25;branch(base.clone().add(new THREE.Vector3(0,.18,0)),new THREE.Vector3(x+Math.cos(a)*1.2*s,y+.02,z+Math.sin(a)*1.2*s),.12,.018);}
  });
  // Leaf litter gathers at grove roots and paving margins, never evenly across the arena.
  for(let i=0;i<(low?450:900);i++){const [x,z]=GROVES[i%GROVES.length],a=rnd()*6.28,r=rnd()*3;const px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;dummy.position.set(px,Math.max(.008,terrainHeight(px,pz)+.015),pz);dummy.rotation.set(0,rnd()*6,.02);dummy.scale.setScalar(.55+rnd()*.35);dummy.updateMatrix();if(leafN<leaves.instanceMatrix.count){leaves.setMatrixAt(leafN,dummy.matrix);leaves.setColorAt(leafN++,new THREE.Color(0x51372b));}}
  leaves.count=leafN;leaves.instanceMatrix.needsUpdate=true;
  // Varied, weathered rock profiles with rounded subdivisions and broad strata.
  const rocks=Array.from({length:5},(_,i)=>{const g=new THREE.SphereGeometry(1,12,8),p=g.attributes.position;for(let k=0;k<p.count;k++){const x=p.getX(k),y=p.getY(k),z=p.getZ(k),r=1+.18*Math.sin(x*3+i)*Math.cos(z*4+i)+.1*Math.sin(y*8+i);p.setXYZ(k,x*r+.15*y,Math.max(-.72,y*(.7+.22*Math.sin(x*3+i))+.12*Math.sin(z*4+i)*Math.cos(x*3)),z*r);}g.computeVertexNormals();return g;});
  rockMat.vertexColors=true;
  for(const g of rocks){const p=g.attributes.position,c=[];for(let i=0;i<p.count;i++){const amount=THREE.MathUtils.smoothstep(p.getY(i)+.12*Math.sin(p.getX(i)*9),.12,.7);c.push(1-amount*.48,1-amount*.24,1-amount*.5);}g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));}
  const formations=[[-12,8,1.5],[13,-1,1.4],[19,17,2.1],[-24,20,2.4],[8,30,1.7],[-18,-4,1.3]];
  const shadowCanvas=canvas(),sc=shadowCanvas.getContext('2d'),sg=sc.createRadialGradient(512,512,0,512,512,512);
  sg.addColorStop(0,'rgba(0,0,0,.45)');sg.addColorStop(.4,'rgba(0,0,0,.22)');sg.addColorStop(1,'rgba(0,0,0,0)');sc.fillStyle=sg;sc.fillRect(0,0,1024,1024);
  const contactMaterial=new THREE.MeshBasicMaterial({map:texture(shadowCanvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  function contact(x,z,s){const g=new THREE.PlaneGeometry(s*3,s*3,8,8);g.rotateX(-Math.PI/2);const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,Math.max(.009,terrainHeight(x+p.getX(i),z+p.getZ(i))+.012));const m=add(g,contactMaterial,x,0,z);m.castShadow=false;}
  GROVES.forEach(([x,z,s])=>contact(x,z,s));
  formations.forEach(([x,z,s])=>contact(x,z,s*1.7));
  formations.forEach(([x,z,s],i)=>{for(let j=0;j<5;j++){const px=x+(j%3-1)*s,pz=z+Math.floor(j/3)*s,sy=s*(.5+rnd()*.6),y=terrainHeight(px,pz);const r=add(rocks[(i+j)%5],rockMat,px,y+sy*.45,pz,true);r.scale.set(s,sy,s*.8);r.rotation.y=rnd()*6;}});
  // Broken, sunk edging follows the court instead of making a straight fence.
  for(const side of [-1,1])for(let i=0;i<25;i++){const z=-8+i*1.15,x=side*(11.5+.45*Math.sin(z*.6));if(rnd()<.2)continue;const m=add(new THREE.BoxGeometry(.5,.12,.85),edge,x,Math.max(.015,terrainHeight(x,z)),z);m.rotation.set(0,rnd()*.25,side*rnd()*.1);}
  // Finite puddle surfaces receive the light; rain rings are masked to these footprints.
  const puddleMat=new THREE.MeshStandardMaterial({color:0x253336,roughness:.38,metalness:0,transparent:true,opacity:.28,depthWrite:false});
  const waterMask=canvas(),wc=waterMask.getContext('2d'),wg=wc.createRadialGradient(512,512,250,512,512,510);
  wg.addColorStop(0,'white');wg.addColorStop(1,'black');wc.fillStyle=wg;wc.fillRect(0,0,1024,1024);puddleMat.alphaMap=texture(waterMask,false);
  PUDDLES.forEach(([x,z,rx,rz])=>{const g=new THREE.CircleGeometry(1,36),p=g.attributes.position;for(let i=1;i<p.count;i++){const a=Math.atan2(p.getY(i),p.getX(i)),r=1+.07*Math.sin(a*7)+.04*Math.cos(a*11);p.setXYZ(i,p.getX(i)*r,p.getY(i)*r,0);}const m=add(g,puddleMat,x,.012,z);m.rotation.x=-Math.PI/2;m.scale.set(rx,rz,1);m.castShadow=false;});
  const rings=world.ripples||[];
  // Existing lanterns retain their colour; short falloff prevents a wash across the court.
  scene.traverse(o=>{if(o.isPointLight && o.distance===9){o.distance=6.5;o.intensity=1.9;}});
  return {update(time){
    rings.forEach((r,i)=>{const [x,z,rx,rz]=PUDDLES[i%PUDDLES.length],t=(time*.7+i*.37)%1,s=.06+t*.42;r.position.set(x+Math.sin(i*8)*rx*.4,.024,z+Math.cos(i*7)*rz*.35);r.scale.set(s,s,1);r.material.opacity=Math.sin(t*Math.PI)*.035;});
  }};
}
