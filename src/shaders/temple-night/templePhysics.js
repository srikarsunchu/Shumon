import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
let initialized;
export async function createTemplePhysics(solids, start) {
  initialized ||= RAPIER.init(); await initialized;
  const world = new RAPIER.World({x:0,y:-20,z:0});
  const v = new THREE.Vector3();
  for(const mesh of solids) {
    const geometry=mesh.geometry, attr=geometry.attributes.position;
    if(!attr || mesh.isInstancedMesh || mesh.userData.noCollision) continue;
    const vertices=new Float32Array(attr.count*3);
    for(let i=0;i<attr.count;i++) { v.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld); v.toArray(vertices,i*3); }
    const indices=geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:attr.count},(_,i)=>i);
    if(!vertices.every(Number.isFinite)) throw new Error(`Invalid collider: ${mesh.name} ${geometry.type}`);
    world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,indices));
  }
  // Low, broad boundary colliders retain the playable landscape.
  for(const [x,z,hx,hz] of [[-58,-10,.5,72],[58,-10,.5,72],[0,48,58,.5],[0,-70,58,.5]])
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx,20,hz).setTranslation(x,10,z));
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x,start.y+.86,start.z));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.55,.28),body);
  const controller=world.createCharacterController(.025);
  controller.enableAutostep(.32,.16,true); controller.enableSnapToGround(.42);
  controller.setMaxSlopeClimbAngle(Math.PI*.26); controller.setMinSlopeSlideAngle(Math.PI*.3);
  if(![start.x,start.y,start.z].every(Number.isFinite)) throw new Error("Invalid player spawn");
  world.step();
  let falling=0;
  return {
    move(dx,dz,dt,out) {
      if(dt<=0) return;
      falling=controller.computedGrounded()?-1:Math.max(-18,falling-20*dt);
      controller.computeColliderMovement(capsule,{x:dx,y:falling*dt,z:dz});
      const m=controller.computedMovement(),p=body.translation();
      body.setNextKinematicTranslation({x:p.x+m.x,y:p.y+m.y,z:p.z+m.z});
      world.timestep=dt; world.step();
      const next=body.translation(); out.set(next.x,next.y-.86,next.z);
      if(next.y < -8) { body.setTranslation({x:0,y:.88,z:7},true); out.set(0,.02,7); falling=0; }
    },
    dispose(){ world.free(); },
  };
}
