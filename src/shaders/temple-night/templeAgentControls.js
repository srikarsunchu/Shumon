export function registerGameTools(game) {
  const context=typeof document==='undefined'?undefined:document.modelContext;
  if(!context?.registerTool)return ()=>{};
  const lifecycle=new AbortController();
  const register=tool=>Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(console.warn);
  register({name:'temple_read_state',description:'Read the current Temple Night player position, movement speed, animation readiness and pause state.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>game.getState()});
  register({name:'temple_control',description:'Play, pause, move, or swing the sword in the current Temple Night scene using the same controls as the player.',inputSchema:{type:'object',properties:{action:{enum:['start','pause','move','swing','draw','sound','look']},degrees:{type:'number',minimum:-180,maximum:180},direction:{enum:['forward','back','left','right']},seconds:{type:'number',minimum:.05,maximum:3},run:{type:'boolean'}},required:['action'],additionalProperties:false},execute:async input=>{
    if(!input || !['start','pause','move','swing','draw','sound','look'].includes(input.action))throw new Error('Unknown action');
    if(input.action==='look'){if(!Number.isFinite(input.degrees)||Math.abs(input.degrees)>180)throw new Error('Choose an angle between -180 and 180');game.look(input.degrees*Math.PI/180);}
    else if(input.action==='move') {
      const key={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD'}[input.direction];
      const seconds=input.seconds??1;
      if(!key || !Number.isFinite(seconds) || seconds<.05 || seconds>3)throw new Error('Choose a direction and a duration between .05 and 3 seconds');
      if(!game.getState().active)throw new Error('Start the scene before moving');
      game.setKey(key,true);game.setKey('ShiftLeft',input.run===true);
      try{await new Promise(resolve=>setTimeout(resolve,seconds*1000));}finally{game.setKey(key,false);game.setKey('ShiftLeft',false);}
    }else if(input.action==='start'){await game.ready;game.start();}
    else if(input.action==='pause')game.pause();else if(input.action==='swing')game.attack();else if(input.action==='draw')game.toggleSword();else game.toggleSound();
    return game.getState();
  }});
  return ()=>lifecycle.abort();
}
