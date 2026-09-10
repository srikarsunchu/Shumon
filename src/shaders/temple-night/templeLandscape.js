import * as THREE from 'three';
import {createForestSoil,grassTuftGeometry,scatterPathEdges} from './templeGround.js';
/* The grounds outside the court. Everything here is tuned to sit with the
   renderer's night: fog 0x050a0e, a blue-white moon key (0xb6dbe4 @ 1.22), the
   blood moon's red rim and the lanterns' 0xff5a24. Albedos are kept low —
   at this exposure anything above ~0.12 starts to read as daylight.

   Playable area (matched by templePhysics.js): |x| < 52, -66 < z < 90.
   Beyond it the ground climbs into a ring of trees and rock, then a dark
   treeline band closes the horizon against the fog. */
const FOG = 0x050a0e;
const PLAY = { x: 52, zNear: 90, zFar: -66 };

export function terrainHeight(x,z) {
  const ax=Math.abs(x);
  /* the court's stone floor (y = 0) shows wherever this dips below it; the
     thresholds wander so the stone/grass contour is not a ruler line */
  const edge=THREE.MathUtils.smoothstep(ax,12+1.4*Math.sin(z*.6)+.7*Math.sin(z*1.7+2),27+2*Math.sin(z*.3));
  const roll=edge*(1.3+Math.sin(z*.055)*.9+.35*Math.sin(x*.21+z*.1)*Math.cos(z*.17)
    +4.4*Math.exp(-((x-39)**2/260+(z+23)**2/700)))
    +THREE.MathUtils.smoothstep(z,17+1.6*Math.sin(x*.5)+.8*Math.sin(x*1.3+1),40)*1.1;
  /* the valley sides: the ground rises past the playable edge so the rim of
     the terrain is never seen against the sky */
  const rim=Math.max(THREE.MathUtils.smoothstep(ax,PLAY.x-2,PLAY.x+28),
    THREE.MathUtils.smoothstep(z,PLAY.zNear-2,PLAY.zNear+32),
    THREE.MathUtils.smoothstep(-z,-PLAY.zFar+4,-PLAY.zFar+30));
  return roll+rim*rim*7.5;
}
/* the walking path: from the torii (0, -8.6) through the spawn (0, 7) and on
   toward the near edge, wandering a little and varying in width */
export function pathCentre(z){return Math.sin(z*.21)*1.1+Math.sin(z*.07)*.9;}
export function pathHalfWidth(z){return 1.35+.25*Math.sin(z*.33+1.3);}
function pathAmount(x,z) {
  if(z<-9)return 0;
  const d=Math.abs(x-pathCentre(z)),w=pathHalfWidth(z);
  /* (smoothstep needs min < max: written as 1 - rising edge) */
  return (1-THREE.MathUtils.smoothstep(d,w-.3,w+.9))*(1-THREE.MathUtils.smoothstep(z,84,90));
}

/* sky: 'sky' is the renderer's authored plane (stars, cloud, valley glow); its
   material's map is hung on a dome here so the player can turn without
   leaving the backdrop. A fog-coloured sphere sits behind it to close the
   view under the dome's rim. */
function buildSky(scene, sky) {
  const back=new THREE.Mesh(new THREE.SphereGeometry(190,24,12),
    new THREE.MeshBasicMaterial({color:FOG,side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false}));
  back.renderOrder=-2; back.userData.noCollision=true; back.frustumCulled=false; scene.add(back);
  if(!sky?.material?.map) return;
  const map=sky.material.map; map.wrapS=THREE.RepeatWrapping; map.repeat.x=2; map.needsUpdate=true;
  const dome=new THREE.Mesh(new THREE.SphereGeometry(205,48,20,0,Math.PI*2,0,Math.PI*.56),
    new THREE.MeshBasicMaterial({map,color:sky.material.color,side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false}));
  /* turned so the warm glow low in the texture sits right of the hall, under
     the moon, where the authored plane put it */
  dome.rotation.y=-1.14; dome.renderOrder=-1; dome.userData.noCollision=true; dome.frustumCulled=false; scene.add(dome);
}

/* the fog wall: two ragged treeline bands, fog off so they stay a silhouette
   at a hundred metres (with fog on, distance lifts them to a pale stripe) */
function buildTreeline(scene, rnd) {
  const build=(radius,base,color,seed)=>{
    const N=160,pos=[],idx=[];
    for(let i=0;i<=N;i++) {
      const a=i/N*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
      const top=base+3.2*Math.sin(i*.37+seed)+2.1*Math.sin(i*1.9+seed*2.3)+1.4*Math.sin(i*4.7+seed)+rnd()*1.8;
      pos.push(c*radius,-6,s*radius-11, c*radius,top,s*radius-11);
      if(i<N){const k=i*2;idx.push(k,k+1,k+2, k+1,k+3,k+2);}
    }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setIndex(idx);
    const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthWrite:false,fog:false}));
    m.renderOrder=1; m.userData.noCollision=true; m.frustumCulled=false; scene.add(m);
  };
  build(152,9.5,0x06090d,1.7);
  build(140,6.5,0x0a1015,4.1);
}

export function buildLandscape(scene, low=false, sky=null) {
  let seed=426; const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0; return (seed>>>0)/4294967296;};
  buildSky(scene, sky);
  buildTreeline(scene, rnd);
  const wind={time:{value:0},strength:{value:.7},direction:{value:new THREE.Vector2(.9,.35)},player:{value:new THREE.Vector3()}};

  /* Moonlit colour modulation sits over locally bundled forest-floor scans.
     UVs use the source capture width (2.1 metres), independent of terrain size. */
  const terrain=new THREE.PlaneGeometry(164,230,132,184); terrain.rotateX(-Math.PI/2); terrain.translate(0,0,10);
  const p=terrain.attributes.position,colors=[];
  const ground=new THREE.Color(0x27372a),moss=new THREE.Color(0x1c2d22),pathC=new THREE.Color(0x3b4136),c=new THREE.Color();
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),z=p.getZ(i); p.setY(i,terrainHeight(x,z)-.08);
    c.copy(ground).lerp(moss,Math.max(0,Math.sin(x*.09+1)*Math.cos(z*.07)+.4*Math.sin(x*.31)*Math.sin(z*.27+1))*.8);
    c.lerp(pathC,pathAmount(x,z)*(.8+rnd()*.2));
    c.multiplyScalar(.82+rnd()*.28); colors.push(c.r,c.g,c.b);
  }
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); terrain.computeVertexNormals();
  const terrainUV=terrain.attributes.uv;for(let i=0;i<p.count;i++)terrainUV.setXY(i,p.getX(i)/2.1,p.getZ(i)/2.1);
  /* Standard-derived material keeps terrain in the collision mesh collector.
     Restrained specular and roughness maps avoid a uniform grey sheen. */
  const groundMesh=new THREE.Mesh(terrain,createForestSoil());groundMesh.name='Scanned forest soil and worn path';groundMesh.receiveShadow=true;
  scene.add(groundMesh);

  function bend(material, amplitude) {
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{uWindTime:wind.time,uWindStrength:wind.strength,uWindDirection:wind.direction,uPlayer:wind.player});
      shader.vertexShader='uniform float uWindTime; uniform float uWindStrength; uniform vec2 uWindDirection; uniform vec3 uPlayer;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        vec4 instanceOrigin = instanceMatrix * vec4(0.,0.,0.,1.);
        float sway = sin(uWindTime*1.6+instanceOrigin.x*.15+instanceOrigin.z*.19);
        transformed.xz += uWindDirection * sway * uWindStrength * pow(max(position.y,0.),1.3) * ${amplitude.toFixed(3)};
        vec2 away = instanceOrigin.xz-uPlayer.xz;
        float influence = 1.-smoothstep(.2,1.15,length(away));
        transformed.xz += normalize(away+vec2(.001)) * influence * max(position.y,0.)*.6;`);
    };
    material.customProgramCacheKey=()=>`temple-wind-${amplitude}`;
  }
  const dummy=new THREE.Object3D();

  /* Concentrate multi-blade tufts on the approach, then thin into the woods.
     Separate six-metre patches let the renderer cull ground outside the view. */
  const grassMat=new THREE.MeshPhysicalMaterial({color:0xa2ad93,vertexColors:true,roughness:1,specularIntensity:0,side:THREE.DoubleSide});
  bend(grassMat,.5);
  const originalCompile=grassMat.onBeforeCompile;
  grassMat.onBeforeCompile=shader=>{originalCompile(shader);
    shader.vertexShader=shader.vertexShader.replace('vec2 away = instanceOrigin.xz-uPlayer.xz;',`float distanceFade=1.-smoothstep(32.,58.,distance(instanceOrigin.xyz,cameraPosition));
      transformed.y*=distanceFade;
      vec2 away = instanceOrigin.xz-uPlayer.xz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      normal=normalize(normal*faceDirection);`);
  };
  grassMat.customProgramCacheKey=()=> 'shumon-tuft-wind-v1';
  const tuft=grassTuftGeometry(rnd,low?5:7),grassPatches=[];
  const tintGrass=new THREE.Color();
  for(let section=0;section<13;section++){
    const z0=16+section*6;
    for(const side of [-1,1]){
      const cap=low?340:850,geometry=tuft.clone(),mesh=new THREE.InstancedMesh(geometry,grassMat,cap);let n=0;
      const patchCentre=new THREE.Vector3(pathCentre(z0+3)+side*10.2,terrainHeight(side*10.2,z0+3)+.3,z0+3);
      geometry.boundingSphere=new THREE.Sphere(patchCentre,14);mesh.frustumCulled=true;
      for(let tries=0;tries<cap*8 && n<cap;tries++){
        const z=z0+rnd()*6,edge=pathHalfWidth(z),d=edge-.2+.25*Math.sin(z*2.7)*Math.cos(z*.6)+Math.pow(rnd(),3)*18;
        const x=pathCentre(z)+side*d;
        const patch=.7+.22*Math.sin(x*1.3+Math.sin(z*.8))*Math.cos(z*1.4);
        if(rnd()>patch || (Math.abs(x)<12 && z<17))continue;
        const shoulder=THREE.MathUtils.smoothstep(d,edge-.2,edge+1.4);
        const scale=(.48+rnd()*.72)*(.4+.6*shoulder);
        dummy.position.set(x,terrainHeight(x,z)-.065,z);dummy.rotation.set(0,rnd()*Math.PI*2,0);
        dummy.scale.set(scale,scale*(.75+rnd()*.55),scale);dummy.updateMatrix();mesh.setMatrixAt(n,dummy.matrix);
        tintGrass.setRGB(.8+rnd()*.3,.82+rnd()*.25,.72+rnd()*.25);mesh.setColorAt(n++,tintGrass);
      }
      mesh.count=n;grassPatches.push({mesh,count:n,centre:patchCentre});mesh.name='Approach grass clumps';mesh.userData.noCollision=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;scene.add(mesh);
    }
  }
  tuft.dispose();
  scatterPathEdges(scene,terrainHeight,pathCentre,pathHalfWidth,rnd,low);
  const farCount=low?2200:6500,far=new THREE.InstancedMesh(grassTuftGeometry(rnd,3),grassMat,farCount);let farN=0;
  for(let i=0;i<farCount*8 && farN<farCount;i++){
    const x=(rnd()-.5)*110,z=rnd()*155-62;
    if((Math.abs(x)<12 && z<17)||(Math.abs(x)<22 && z<-32)||pathAmount(x,z)>.2 || (z>16 && Math.abs(x-pathCentre(z))<19))continue;
    dummy.position.set(x,terrainHeight(x,z)-.065,z);dummy.rotation.set(0,rnd()*6.28,0);dummy.scale.setScalar(.7+rnd()*.8);dummy.updateMatrix();far.setMatrixAt(farN++,dummy.matrix);
  }
  far.count=farN;far.name='Woodland grass';far.userData.noCollision=true;far.receiveShadow=true;far.instanceMatrix.needsUpdate=true;scene.add(far);

  /* ---- trees: a trunk and a crown of three offset lobes, darker underneath.
     The lobes share vertex colours; each tree tints them a little. */
  const crownColors=geo=>{
    const cp=geo.attributes.position,cc=[],under=new THREE.Color(0x020304),top=new THREE.Color(0x1c0e0c);
    for(let i=0;i<cp.count;i++) { const t=THREE.MathUtils.smoothstep(cp.getY(i)/geo.parameters.radius,-.55,.75); c.copy(under).lerp(top,t); cc.push(c.r,c.g,c.b); }
    geo.setAttribute('color',new THREE.Float32BufferAttribute(cc,3)); return geo;
  };
  const leafMat=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1}); bend(leafMat,.04);
  const bark=new THREE.MeshPhysicalMaterial({color:0x08090b,roughness:1,specularIntensity:.15}); /* Standard-derived: the trunks collide */
  const INNER=0, RING=low?70:110;
  const mainNear=new THREE.InstancedMesh(crownColors(new THREE.IcosahedronGeometry(1.8,2)),leafMat,INNER);
  const mainFar=new THREE.InstancedMesh(crownColors(new THREE.IcosahedronGeometry(2.2,1)),leafMat,RING);
  const lobes=new THREE.InstancedMesh(crownColors(new THREE.IcosahedronGeometry(1.3,1)),leafMat,(INNER+RING)*2);
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.16,.38,1,6),bark,RING);
  [mainNear,mainFar,lobes,trunks].forEach(m=>{m.userData.noCollision=true;m.castShadow=true;});
  let lobeN=0;
  const tint=new THREE.Color();
  function crown(mesh,index,x,y,z,s) {
    const cool=rnd()<.3;
    tint.setRGB(cool?.55:.9+rnd()*.3, cool?1.0:.9+rnd()*.2, cool?.95:.85+rnd()*.2);
    dummy.position.set(x,y,z); dummy.scale.set(s*(1+rnd()*.6),s*(.7+rnd()*.6),s*(1+rnd()*.6)); dummy.rotation.set(0,rnd()*6,0); dummy.updateMatrix();
    mesh.setMatrixAt(index,dummy.matrix); mesh.setColorAt(index,tint);
    for(let k=0;k<2;k++) {
      const a=rnd()*Math.PI*2,r=s*(.8+rnd()*.7);
      dummy.position.set(x+Math.cos(a)*r,y-s*(.35+rnd()*.5),z+Math.sin(a)*r);
      dummy.scale.setScalar(s*(.7+rnd()*.5)); dummy.rotation.set(rnd()*.6,rnd()*6,rnd()*.6); dummy.updateMatrix();
      lobes.setMatrixAt(lobeN,dummy.matrix); lobes.setColorAt(lobeN++,tint);
    }
  }
  for(let i=0;i<INNER;i++) {
    const side=i%2?1:-1,x=side*(29+rnd()*22),z=rnd()*104-63,y=terrainHeight(x,z),h=4+rnd()*5;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.14,.30,h,7),bark); trunk.position.set(x,y+h/2,z); trunk.castShadow=true; scene.add(trunk);
    crown(mainNear,i,x,y+h,z,1);
  }
  /* the ring: denser and taller, just past the playable edge */
  for(let i=0;i<RING;i++) {
    let x,z; const pick=rnd();
    if(pick<.55) { x=(i%2?1:-1)*(PLAY.x+3+rnd()*17); z=rnd()*150-86; }
    else if(pick<.88) { x=(rnd()-.5)*150; z=PLAY.zNear+3+rnd()*20; }
    else { x=(rnd()-.5)*150; z=PLAY.zFar-6-rnd()*16; }
    const y=terrainHeight(x,z),h=6+rnd()*6;
    dummy.position.set(x,y+h/2,z); dummy.scale.set(1.1,h,1.1); dummy.rotation.set(0,0,0); dummy.updateMatrix(); trunks.setMatrixAt(i,dummy.matrix);
    crown(mainFar,i,x,y+h,z,1.25);
  }
  [mainNear,mainFar,lobes,trunks].forEach(m=>{m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;scene.add(m);});

  /* ---- rocks: one shared, vertex-coloured block — wet blue on top, dark
     on the sides — as separate meshes so they collide */
  const rockGeo=new THREE.IcosahedronGeometry(1,2),rc=[],rn=rockGeo.attributes.normal,rp=rockGeo.attributes.position;
  const rockTop=new THREE.Color(0x0f171c),rockSide=new THREE.Color(0x060809);
  for(let i=0;i<rp.count;i++) { c.copy(rockSide).lerp(rockTop,THREE.MathUtils.smoothstep(rn.getY(i)*.6+rp.getY(i)*.4,-.1,.9)); rc.push(c.r,c.g,c.b); }
  rockGeo.setAttribute('color',new THREE.Float32BufferAttribute(rc,3));
  const rockMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.62,metalness:.04});
  const rock=(x,z,sx,sy,sz)=>{
    const m=new THREE.Mesh(rockGeo,rockMaterial);
    m.position.set(x,terrainHeight(x,z)+sy*.35,z); m.scale.set(sx,sy,sz); m.rotation.set(rnd()*.5,rnd()*6,rnd()*.5); m.castShadow=m.receiveShadow=true; scene.add(m);
  };
  for(let i=0;i<52;i++) rock((i%2?1:-1)*(38+rnd()*14),rnd()*112-68,1+rnd()*3,.8+rnd()*2,1+rnd()*2);
  for(let i=0;i<14;i++) rock((i%2?1:-1)*(14+rnd()*12),rnd()*70-30,.5+rnd()*1.2,.4+rnd()*.8,.5+rnd()*1.2);
  for(let i=0;i<(low?36:64);i++) {
    const pick=rnd(); let x,z;
    if(pick<.6) { x=(i%2?1:-1)*(PLAY.x+2+rnd()*18); z=rnd()*150-86; }
    else if(pick<.9) { x=(rnd()-.5)*140; z=PLAY.zNear+2+rnd()*18; }
    else { x=(rnd()-.5)*140; z=PLAY.zFar-5-rnd()*14; }
    rock(x,z,1.5+rnd()*3.5,1+rnd()*2.6,1.5+rnd()*3);
  }

  /* ambient: a faint cool sky over a near-black ground. The renderer already
     carries a hemisphere of its own (0x53838f / 0x060a08 @ .13); this only
     keeps the far grass from going to pure silhouette. */
  scene.add(new THREE.HemisphereLight(0x1c3140,0x040608,.16));
  return {
    wind,
    update(time,player) {wind.time.value=time;wind.strength.value=.6+.35*Math.sin(time*.24)+.18*Math.sin(time*.63);if(player){wind.player.value.copy(player);for(const patch of grassPatches){const d=patch.centre.distanceTo(player);patch.mesh.visible=d<68;patch.mesh.count=Math.round(patch.count*(1-.7*THREE.MathUtils.smoothstep(d,14,48)));}}},
  };
}
