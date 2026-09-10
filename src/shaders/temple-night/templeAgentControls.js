const ACTIONS=['start','pause','restart','move','swing','draw','guard','parry','dodge','standoff','sound','look','stance'];
export function registerGameTools(game) {
  const context=typeof document==='undefined'?undefined:document.modelContext;
  if(!context?.registerTool)return ()=>{};
  const lifecycle=new AbortController();
  const register=tool=>Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(console.warn);
  register({name:'temple_read_state',description:'Read the current Temple Night run: phase (title, standoff, fight, clear, dead, victory), wave, health, guard, parry window, dodge, stance, the enemies with their health and distance, the standoff and banner, the result, the player position and speed, sound and readiness.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>game.getState()});
  register({name:'temple_control',description:'Play the Temple Night duel with the same controls as the player: start, pause or restart the run, move, swing the sword, draw, guard (down/up), parry, dodge, hold and release the standoff (down/up), look, choose a stance (stone, water, wind, moon) or toggle sound.',inputSchema:{type:'object',properties:{action:{enum:ACTIONS},degrees:{type:'number',minimum:-180,maximum:180},direction:{enum:['forward','back','left','right']},seconds:{type:'number',minimum:.05,maximum:3},run:{type:'boolean'},down:{type:'boolean',description:'guard and standoff: press (true, the default) or release (false)'},stance:{enum:['stone','water','wind','moon']}},required:['action'],additionalProperties:false},execute:async input=>{
    if(!input || !ACTIONS.includes(input.action))throw new Error('Unknown action');
    const down=input.down!==false;
    if(input.action==='look'){if(!Number.isFinite(input.degrees)||Math.abs(input.degrees)>180)throw new Error('Choose an angle between -180 and 180');game.look(input.degrees*Math.PI/180);}
    else if(input.action==='stance'){if(!['stone','water','wind','moon'].includes(input.stance))throw new Error('Choose a stance: stone, water, wind or moon');game.setStance(input.stance);}
    else if(input.action==='move') {
      const key={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD'}[input.direction];
      const seconds=input.seconds??1;
      if(!key || !Number.isFinite(seconds) || seconds<.05 || seconds>3)throw new Error('Choose a direction and a duration between .05 and 3 seconds');
      if(!game.getState().active)throw new Error('Start the scene before moving');
      game.setKey(key,true);game.setKey('ShiftLeft',input.run===true);
      try{await new Promise(resolve=>setTimeout(resolve,seconds*1000));}finally{game.setKey(key,false);game.setKey('ShiftLeft',false);}
    }else if(input.action==='start'){await game.ready;game.start();}
    else if(input.action==='pause')game.pause();else if(input.action==='restart')game.restart();
    else if(input.action==='swing')game.attack();else if(input.action==='draw')game.toggleSword();
    else if(input.action==='guard')game.guard(down);else if(input.action==='parry')game.parry();else if(input.action==='dodge')game.dodge();
    else if(input.action==='standoff')game.holdStandoff(down);
    else game.toggleSound();
    return game.getState();
  }});
  return ()=>lifecycle.abort();
}
