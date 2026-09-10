import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const names={hips:'hips',spine:'spine.001',chest:'spine.003',neck:'neck',head:'head',leftArm:'upper_arm.L',leftForearm:'forearm.L',leftHand:'hand.L',rightArm:'upper_arm.R',rightForearm:'forearm.R',rightHand:'hand.R',leftThigh:'thigh.L',leftShin:'shin.L',leftFoot:'foot.L',rightThigh:'thigh.R',rightShin:'shin.R',rightFoot:'foot.R'};
export async function loadAuthoredMotion(samurai, data) {
  const gltf=data || await new GLTFLoader().loadAsync('/assets/quaternius/animations.gltf');
  const source=gltf.scene; source.rotation.y=Math.PI;
  const mixer=new THREE.AnimationMixer(source);
  const clips=Object.fromEntries(gltf.animations.map(c=>[c.name,c]));
  mixer.clipAction(clips.A_TPose).play(); mixer.update(0); source.updateMatrixWorld(true);
  samurai.update(0,{speed:0,run:0,phase:0,drawn:false,swing:-1,time:0});
  samurai.joints.leftArm.rotation.z=-Math.PI/2; samurai.joints.rightArm.rotation.z=Math.PI/2;
  samurai.group.updateMatrixWorld(true);
  const rootInverse=samurai.group.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bindings=Object.entries(names).map(([key,name])=>{
    const joint=samurai.joints[key],bone=source.getObjectByName(`DEF-${name.replaceAll('.','')}`) || source.getObjectByName(`DEF-${name}`);
    if(!bone) throw new Error(`Animation bone missing: ${name}`);
    return {joint,bone,sourceRest:bone.getWorldQuaternion(new THREE.Quaternion()).invert(),rest:joint.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInverse)};
  });
  mixer.stopAllAction();
  const actions={};
  for(const name of ['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Sprint_Loop','Sword_Idle','Sword_Attack']) {
    actions[name]=mixer.clipAction(clips[name]).play(); actions[name].setEffectiveWeight(0);
  }
  actions.Sword_Attack.paused=true;
  /* Locomotion is driven by distance, not by the clock. Free-running walk and
     jog loops blended at walking speed drift in and out of step with each
     other on a beat of a few seconds, which reads as the walk stalling and
     restarting. Instead every locomotion clip is scrubbed from the gait phase
     the controller accumulates per metre, with each clip's own origin set to
     the moment its left foot is furthest forward, so a blend of any two is
     always the same footfall. */
  const LOCO=['Walk_Loop','Jog_Fwd_Loop','Sprint_Loop'];
  const hipsBone=source.getObjectByName('DEF-hips'), footBone=source.getObjectByName('DEF-footL')||source.getObjectByName('DEF-foot.L');
  const origin={}, pA=new THREE.Vector3(), pB=new THREE.Vector3();
  for(const name of LOCO) {
    const a=actions[name], d=clips[name].duration; let best=-Infinity, bestT=0;
    for(const other of Object.values(actions)) other.setEffectiveWeight(other===a?1:0);
    for(let i=0;i<48;i++) {
      a.time=d*i/48; mixer.update(0); source.updateMatrixWorld(true);
      const forward=-(footBone.getWorldPosition(pA).z-hipsBone.getWorldPosition(pB).z);   /* the source faces −z */
      if(forward>best){best=forward;bestT=a.time;}
    }
    origin[name]=bestT; a.paused=true;
  }
  for(const a of Object.values(actions)) a.setEffectiveWeight(0);
  const worldQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),rootQ=new THREE.Quaternion();
  return {
    update(dt,s) {
      // Walk → Jog → Sprint by ground speed: the jog carries the 1.6–3.6 m/s band the walk used to stretch over.
      const speed=s.speed*5.6, move=THREE.MathUtils.smoothstep(speed,.03,.8),jog=THREE.MathUtils.smoothstep(speed,1.6,3.2),run=THREE.MathUtils.smoothstep(speed,3.6,5.6);
      const attack=s.swing>=0?Math.min(1,s.swing*12,(1-s.swing)*10):0;
      const weights={Idle_Loop:!s.drawn?1-move:0,Sword_Idle:s.drawn?1-move:0,Walk_Loop:move*(1-jog),Jog_Fwd_Loop:move*jog*(1-run),Sprint_Loop:move*run};
      for(const [name,weight] of Object.entries(weights)) actions[name].setEffectiveWeight(weight*(1-attack));
      const cycle=((s.phase||0)/(2*Math.PI))%1;
      for(const name of LOCO) { const d=clips[name].duration; actions[name].time=(((cycle*d+origin[name])%d)+d)%d; }
      actions.Sword_Attack.time=Math.max(0,s.swing)*clips.Sword_Attack.duration;
      actions.Sword_Attack.setEffectiveWeight(attack);
      mixer.update(dt); source.updateMatrixWorld(true);
      samurai.group.getWorldQuaternion(rootQ);
      for(const b of bindings) {
        b.bone.getWorldQuaternion(worldQ).multiply(b.sourceRest).multiply(b.rest).premultiply(rootQ);
        b.joint.parent.getWorldQuaternion(parentQ).invert(); b.joint.quaternion.copy(parentQ.multiply(worldQ));
        b.joint.updateWorldMatrix(false,true);
      }
    },
    dispose() {mixer.stopAllAction();mixer.uncacheRoot(source);source.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});},
  };
}

// Two-bone foot correction with a short stance lock. Authored upper-body poses
// remain untouched; only hips/knees/ankles are corrected against nearby ground.
export function createFootPlant(samurai) {
  const anchors=[null,null];
  const hip=new THREE.Vector3(),knee=new THREE.Vector3(),ankle=new THREE.Vector3(),goal=new THREE.Vector3(),pole=new THREE.Vector3();
  const axis=new THREE.Vector3(),bend=new THREE.Vector3(),wantedKnee=new THREE.Vector3();
  const q=new THREE.Quaternion(),parent=new THREE.Quaternion(),from=new THREE.Vector3(),to=new THREE.Vector3();
  function aim(joint,child,point) {
    const start=joint.getWorldPosition(new THREE.Vector3());
    from.subVectors(child.getWorldPosition(new THREE.Vector3()),start).normalize();to.subVectors(point,start).normalize();
    q.setFromUnitVectors(from,to).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
    joint.parent.getWorldQuaternion(parent).invert();joint.quaternion.copy(parent.multiply(q));joint.updateWorldMatrix(false,true);
  }
  return (sample,dt,speed)=>{
    samurai.group.updateMatrixWorld(true);
    samurai.legs.forEach((leg,i)=>{
      leg.hip.getWorldPosition(hip);leg.knee.getWorldPosition(knee);leg.foot.getWorldPosition(ankle);
      const ground=sample(ankle.x,ankle.z,ankle.y);
      if(ground===undefined) {anchors[i]=null;return;}
      const sole=ground+.10, contact=ankle.y-sole<.13;
      if(!contact || (anchors[i] && anchors[i].distanceTo(ankle)>.4)) anchors[i]=null;
      if(contact && !anchors[i]) anchors[i]=new THREE.Vector3(ankle.x,sole,ankle.z);
      goal.copy(anchors[i] || ankle);goal.y=Math.max(goal.y,sole);
      if(speed<.08) {goal.x=ankle.x;goal.z=ankle.z;}
      if(goal.distanceTo(ankle)>.38) return;
      const a=hip.distanceTo(knee),b=knee.distanceTo(ankle),d=THREE.MathUtils.clamp(hip.distanceTo(goal),.1,a+b-.001);
      axis.subVectors(goal,hip).normalize();
      pole.set(0,0,-1).applyQuaternion(samurai.group.quaternion);
      bend.copy(pole).addScaledVector(axis,-pole.dot(axis)).normalize();
      const along=(a*a-b*b+d*d)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along));
      wantedKnee.copy(hip).addScaledVector(axis,along).addScaledVector(bend,height);
      aim(leg.hip,leg.knee,wantedKnee);aim(leg.knee,leg.foot,goal);
      // Keep the sole level while planted.
      if(contact) {leg.foot.parent.getWorldQuaternion(parent).invert();leg.foot.quaternion.copy(parent.multiply(samurai.group.getWorldQuaternion(q)));}
    });
  };
}
