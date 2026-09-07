import * as THREE from 'three';
export function terrainHeight(x,z) {
  const edge=THREE.MathUtils.smoothstep(Math.abs(x),12,27);
  return edge*(1.3+Math.sin(z*.055)*.9+4.4*Math.exp(-((x-39)**2/260+(z+23)**2/700)))+
    THREE.MathUtils.smoothstep(z,18,40)*1.1;
}
export function buildLandscape(scene, low=false) {
  const skyGeo=new THREE.SphereGeometry(170,32,16),skyColors=[];
  const skyPositions=skyGeo.attributes.position;
  for(let i=0;i<skyPositions.count;i++) {
    const t=THREE.MathUtils.smoothstep(skyPositions.getY(i),-20,110);
    const c=new THREE.Color(0x142632).lerp(new THREE.Color(0x02050b),t);skyColors.push(c.r,c.g,c.b);
  }
  skyGeo.setAttribute('color',new THREE.Float32BufferAttribute(skyColors,3));
  const sky=new THREE.Mesh(skyGeo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false,fog:false}));sky.userData.noCollision=true;scene.add(sky);
  const wind={time:{value:0},strength:{value:.7},direction:{value:new THREE.Vector2(.9,.35)},player:{value:new THREE.Vector3()}};
  let seed=426; const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0; return (seed>>>0)/4294967296;};
  const terrain=new THREE.PlaneGeometry(118,122,118,122); terrain.rotateX(-Math.PI/2); terrain.translate(0,0,-11);
  const p=terrain.attributes.position,colors=[];
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),z=p.getZ(i); p.setY(i,terrainHeight(x,z)-.012);
    const path=Math.abs(Math.abs(x)-(22+Math.sin(z*.055)*7))<2.1;
    const c=new THREE.Color(path?0x414744:0x263731); c.multiplyScalar(.83+rnd()*.23); colors.push(c.r,c.g,c.b);
  }
  terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); terrain.computeVertexNormals();
  const ground=new THREE.Mesh(terrain,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93})); ground.receiveShadow=true; scene.add(ground);
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
  const grassGeo=new THREE.PlaneGeometry(.12,.85,1,3); grassGeo.translate(0,.425,0);
  const gp=grassGeo.attributes.position;
  for(let i=0;i<gp.count;i++) gp.setX(i,gp.getX(i)*(1-gp.getY(i)*.95));
  const grassMat=new THREE.MeshStandardMaterial({color:0x46563a,roughness:1,side:THREE.DoubleSide}); bend(grassMat,.32);
  const count=low?6500:15000;
  const grass=new THREE.InstancedMesh(grassGeo,grassMat,count); grass.userData.noCollision=true; grass.receiveShadow=true;
  const dummy=new THREE.Object3D(); let n=0;
  for(let i=0;i<count*3 && n<count;i++) {
    const x=(rnd()-.5)*110,z=rnd()*110-65;
    if((Math.abs(x)<12 && z<16) || (Math.abs(x)<22 && z < -32)) continue;
    if(Math.abs(Math.abs(x)-(22+Math.sin(z*.055)*7))<2.2) continue;
    dummy.position.set(x,terrainHeight(x,z),z); dummy.rotation.set(0,rnd()*Math.PI,0); dummy.scale.setScalar(.65+rnd()*.9); dummy.updateMatrix(); grass.setMatrixAt(n++,dummy.matrix);
  }
  grass.count=n; grass.instanceMatrix.needsUpdate=true; scene.add(grass);
  const bark=new THREE.MeshStandardMaterial({color:0x29312c,roughness:1});
  const leafMat=new THREE.MeshStandardMaterial({color:0x4c2921,roughness:1}); bend(leafMat,.04);
  const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.8,2),leafMat,90); crowns.userData.noCollision=true;
  for(let i=0;i<90;i++) {
    const side=i%2?1:-1,x=side*(29+rnd()*24),z=rnd()*108-65,y=terrainHeight(x,z),h=4+rnd()*5;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.14,.30,h,7),bark); trunk.position.set(x,y+h/2,z); trunk.castShadow=true; scene.add(trunk);
    dummy.position.set(x,y+h,z); dummy.scale.set(1+rnd(),.7+rnd()*.8,1+rnd()); dummy.rotation.set(0,rnd()*6,0); dummy.updateMatrix(); crowns.setMatrixAt(i,dummy.matrix);
  }
  crowns.castShadow=true; crowns.instanceMatrix.needsUpdate=true; scene.add(crowns);
  const rockMaterial=new THREE.MeshStandardMaterial({color:0x444c4b,roughness:.95});
  for(let i=0;i<52;i++) {
    const x=(i%2?1:-1)*(40+rnd()*15),z=rnd()*115-67;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1,0),rockMaterial);
    rock.position.set(x,terrainHeight(x,z)+.4,z); rock.scale.set(1+rnd()*3,.8+rnd()*2,1+rnd()*2); rock.rotation.set(rnd(),rnd()*6,rnd()); rock.castShadow=rock.receiveShadow=true; scene.add(rock);
  }
  scene.add(new THREE.HemisphereLight(0x91b2c8,0x293124,.28));
  return {
    wind,
    update(time,player) {wind.time.value=time;wind.strength.value=.6+.35*Math.sin(time*.24)+.18*Math.sin(time*.63);if(player)wind.player.value.copy(player);},
  };
}
