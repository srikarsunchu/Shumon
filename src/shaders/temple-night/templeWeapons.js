import * as THREE from 'three';

// Equipment shares the fighter's disposal/fade list and follows the hand bones.
export function equipEnemy(rig, type) {
  const wood = new THREE.MeshStandardMaterial({color:0x493127,roughness:.82});
  const iron = new THREE.MeshStandardMaterial({color:0x66696a,metalness:.7,roughness:.38});
  const red = new THREE.MeshStandardMaterial({color:0x602e29,roughness:.6});
  const materials=[wood,iron,red];
  const add=(parent,geo,mat,x=0,y=0,z=0)=>{
    const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=true;
    parent.add(m); rig.meshes.push(m); return m;
  };
  const shaft=(parent,radius,length,z,mat)=>{
    const m=add(parent,new THREE.CylinderGeometry(radius,radius,length,10),mat,0,0,z);
    m.rotation.x=Math.PI/2; return m;
  };
  let weapon=null,shield=null;
  if(type==='spearman' || type==='brute') {
    weapon=new THREE.Group(); weapon.name=type==='spearman'?'yari':'kanabo';
    // The equipment inherits the katana's grip transform, but replaces its mesh.
    rig.katana.add(weapon);
    for(const child of rig.katana.children) if(child!==weapon) child.visible=false;
    if(type==='spearman') {
      shaft(weapon,.023,2.15,-.38,wood);
      shaft(weapon,.029,.18,-1.42,iron);
      const point=add(weapon,new THREE.ConeGeometry(.07,.42,4),iron,0,0,-1.7);
      point.rotation.x=-Math.PI/2; point.scale.z=.3;
      shaft(weapon,.028,.2,.53,red);
    } else {
      shaft(weapon,.032,.52,.03,wood);
      shaft(weapon,.095,.9,-.66,wood);
      for(let row=0;row<5;row++) {
        const z=-.29-row*.18;
        shaft(weapon,.101,.045,z,iron);
        for(let side=0;side<6;side++) {
          const a=side*Math.PI/3;
          const stud=add(weapon,new THREE.SphereGeometry(.025,5,3),iron,Math.cos(a)*.099,Math.sin(a)*.099,z);
          stud.scale.z=.7;
        }
      }
    }
  }
  if(type==='shieldman') {
    shield=new THREE.Group(); shield.name='shield'; rig.joints.leftForearm.add(shield);
    shield.position.set(0,-.16,-.11);
    // A tall plank shield, cross-strapped and iron-rimmed, readable at combat distance.
    for(let i=0;i<5;i++) add(shield,new THREE.BoxGeometry(.115,.82,.055),i%2?wood:red,(i-2)*.12,0,0);
    for(const y of [-.4,.4]) add(shield,new THREE.BoxGeometry(.63,.045,.075),iron,0,y,0);
    for(const x of [-.3,.3]) add(shield,new THREE.BoxGeometry(.035,.82,.075),iron,x,0,0);
    for(const y of [-.23,.23]) add(shield,new THREE.BoxGeometry(.59,.055,.075),iron,0,y,0);
    add(shield,new THREE.SphereGeometry(.09,12,8),iron,0,0,-.045).scale.z=.45;
  }
  // Unused material instances have no mesh owner to dispose them later.
  for(const m of materials) if(!rig.meshes.some(mesh=>mesh.material===m)) m.dispose();
  return {weapon,shield,update(){
    if(weapon) {rig.katana.visible=true; rig.saya.visible=false; rig.sheathedHilt.visible=false;}
  }};
}

// Directional layers act on the captured movement, never replace its full-body timing.
export function applyCombatStyle(rig, s) {
  if(s.react || !s.drawn) return;
  const J=rig.joints, t=s.telegraph>0?s.telegraph*.2:s.swing;
  const striking=t>=0;
  const w=striking?Math.max(0,Math.min(1,t*12,(1-t)*10)):0;
  const p=THREE.MathUtils.smoothstep(t,.2,.65);
  const style=s.weapon || s.stance || 'stone';
  if(style==='water') {
    J.chest.rotation.y+=(-.6+1.2*p)*w;
    J.rightArm.rotation.z-=.65*w; J.leftArm.rotation.z-=.45*w;
  } else if(style==='wind') {
    J.chest.rotation.y+=(.55-1.1*p)*w;
    J.rightArm.rotation.z+=.85*w; J.leftArm.rotation.z+=.5*w;
    J.chest.rotation.x-=.22*w;
  } else if(style==='moon') {
    J.chest.rotation.y+=(-.95+1.9*p)*w;
    J.rightArm.rotation.z-=1.15*w; J.leftArm.rotation.z-=.8*w;
    J.hips.rotation.y+=(-.25+.5*p)*w;
  } else if(style==='spearman') {
    // Keep the pole level and extend through the tell into a forward thrust.
    J.rightArm.rotation.x+=.65; J.rightForearm.rotation.x-=.35;
    rig.group.updateMatrixWorld(true);
    const facing=rig.group.getWorldQuaternion(new THREE.Quaternion());
    const parent=rig.katana.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    rig.katana.quaternion.copy(parent.multiply(facing));
    rig.katana.position.z-=.5*Math.sin(p*Math.PI)*w;
    J.chest.rotation.x-=.15*w;
  } else if(style==='brute') {
    J.chest.rotation.x+=(-.3+.65*p)*w;
    J.rightArm.rotation.x+=.4*w; J.leftArm.rotation.x+=.4*w;
  }
  if(style==='shieldman') {
    J.leftArm.rotation.set(.4,0,.25); J.leftForearm.rotation.set(1.0,0,0);
    const shield=rig.group.getObjectByName('shield');
    if(shield) {
      rig.group.updateMatrixWorld(true);
      shield.quaternion.copy(shield.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rig.group.getWorldQuaternion(new THREE.Quaternion())));
    }
  }
}
