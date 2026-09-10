import * as THREE from 'three';

// One terrain surface: the path and leaf bed share colour, relief, roughness
// and a feathered edge. Metre-based UVs keep grit the same size everywhere.
export function createForestSoil() {
  const material=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:1,metalness:0,specularIntensity:.16});
  if(typeof document==='undefined' || typeof document.createElement!=='function')return material;
  const loader=new THREE.TextureLoader();
  function load(name,color=false){const t=loader.load(`/assets/ground/${name}.webp`);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(color)t.encoding=THREE.sRGBEncoding;return t;}
  const forest={color:load('forest_floor_diff',true),normal:load('forest_floor_nor_gl'),surface:load('forest_floor_arm')};
  const dirt={color:load('dirt_floor_diff',true),normal:load('dirt_floor_nor_gl'),surface:load('dirt_floor_arm')};
  material.map=forest.color;material.normalMap=forest.normal;material.normalScale.set(.85,.85);
  material.roughnessMap=forest.surface;
  // Retain the extra maps as material properties so renderer teardown finds them.
  material.pathColorMap=dirt.color;material.pathNormalMap=dirt.normal;material.pathSurfaceMap=dirt.surface;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{uPathColor:{value:dirt.color},uPathNormal:{value:dirt.normal},uPathSurface:{value:dirt.surface}});
    shader.vertexShader='varying vec3 vGround;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=position;');
    shader.fragmentShader=`varying vec3 vGround;
      uniform sampler2D uPathColor,uPathNormal,uPathSurface;
      float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float groundNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(groundHash(i),groundHash(i+vec2(1.,0.)),f.x),mix(groundHash(i+vec2(0.,1.)),groundHash(i+1.),f.x),f.y);}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      float centre=sin(vGround.z*.21)*1.1+sin(vGround.z*.07)*.9;
      float width=1.35+.25*sin(vGround.z*.33+1.3);
      float edgeNoise=(groundNoise(vGround.xz*3.3)-.5)*.36+(groundNoise(vGround.xz*11.)-.5)*.10;
      float route=(1.-smoothstep(width-.3,width+.9,abs(vGround.x-centre)+edgeNoise))*smoothstep(-10.,-6.,vGround.z)*(1.-smoothstep(84.,90.,vGround.z));
      float macro=groundNoise(vGround.xz*.27);
      vec2 soilUV=vUv,offsetUV=vUv*.79+vec2(.37,.61);
      float tileBlend=smoothstep(.25,.75,groundNoise(vGround.xz*.18));
      vec3 bed=mix(texture2D(map,soilUV).rgb,texture2D(map,offsetUV).rgb,tileBlend*.5);
      vec3 track=mix(texture2D(uPathColor,soilUV).rgb,texture2D(uPathColor,offsetUV).rgb,tileBlend*.5);
      diffuseColor.rgb*=mix(bed,track,route)*mix(.72,1.12,macro);
      vec3 groundSurface=mix(texture2D(roughnessMap,soilUV).rgb,texture2D(uPathSurface,soilUV).rgb,route);
      diffuseColor.rgb*=mix(.72,1.,groundSurface.r);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`float damp=smoothstep(.58,.82,groundNoise(vGround.xz*.8))*route;
      float roughnessFactor=mix(clamp(groundSurface.g*.95,.72,1.),.48,damp*.55);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
      vec3 soilNormal=mix(texture2D(normalMap,soilUV).xyz,texture2D(uPathNormal,soilUV).xyz,route)*2.-1.;
      soilNormal.xy*=normalScale;
      normal=perturbNormal2Arb(-vViewPosition,normal,soilNormal,faceDirection);
    `);
  };
  material.customProgramCacheKey=()=> 'shumon-scanned-ground-v1';
  return material;
}

// Seven independently curled ribbons per tuft with narrow tips.
// No alpha cards: dense grass avoids transparency overdraw.
export function grassTuftGeometry(random,blades=7) {
  const pos=[],uv=[],col=[],indices=[];
  for(let b=0;b<blades;b++){
    const a=random()*Math.PI*2,h=.18+random()*.28,width=.006+random()*.010;
    const lean=.1+random()*.24,bx=(random()-.5)*.19,bz=(random()-.5)*.19;
    const ca=Math.cos(a),sa=Math.sin(a),base=pos.length/3;
    const root=new THREE.Color(0x070d05),tip=new THREE.Color(b%7===0?0x34331d:0x283b21);
    for(let row=0;row<=4;row++){
      const t=row/4,w=width*(1-t*.97),curl=lean*t*t;
      for(let side=0;side<2;side++){
        const across=(side*2-1)*w;
        pos.push(bx+ca*curl-sa*across,h*t-(t*t*t)*h*.18,bz+sa*curl+ca*across);
        uv.push(side,t);const c=root.clone().lerp(tip,Math.pow(t,.55));col.push(c.r,c.g,c.b);
      }
      if(row<4){const i=base+row*2;indices.push(i,i+2,i+1,i+1,i+2,i+3);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(indices);g.computeVertexNormals();
  // Tip normals turn up toward the sky, avoiding black cut-out backs.
  const n=g.attributes.normal;
  for(let i=0;i<n.count;i++){const v=new THREE.Vector3(n.getX(i)*.35,.8+Math.abs(n.getY(i))*.2,n.getZ(i)*.35).normalize();n.setXYZ(i,v.x,v.y,v.z);}
  return g;
}

export function scatterPathEdges(scene,height,centre,halfWidth,random,low) {
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const stones=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshPhysicalMaterial({color:0x161a13,roughness:1,specularIntensity:0}),low?300:850);
  const twigs=new THREE.InstancedMesh(new THREE.CylinderGeometry(.006,.011,1,5),new THREE.MeshPhysicalMaterial({color:0x100d09,roughness:1,specularIntensity:0}),low?130:360);
  for(const [mesh,isTwig] of [[stones,false],[twigs,true]]){
    for(let i=0;i<mesh.count;i++){
      const z=18+random()*70,side=random()<.5?-1:1;
      const x=centre(z)+side*(halfWidth(z)*.65+random()*1.5),y=Math.max(.005,height(x,z)-.064);
      dummy.position.set(x,y,z);
      if(isTwig){dummy.rotation.set(Math.PI/2,0,random()*Math.PI*2);dummy.scale.set(1,.12+random()*.32,1);}
      else{const r=.008+Math.pow(random(),2)*.036;dummy.rotation.set(random()*.5,random()*6.28,0);dummy.scale.set(r,r*(.3+random()*.35),r*(.7+random()*.6));}
      dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);color.setScalar(.6+random()*.7);mesh.setColorAt(i,color);
    }
    mesh.name=isTwig?'Broken twigs along the track':'Small stones in the path shoulder';mesh.userData.noCollision=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;scene.add(mesh);
  }
}
