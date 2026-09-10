// All sounds are synthesized locally; there are no external audio recordings.
// Every method is safe before init (no AudioContext yet) and while the audio
// is disabled or inactive: it simply returns. The gameplay calls these
// optional-chained per docs/GAME.md, so nothing here may throw.
export function createTempleAudio() {
  let context,master,windGain,rainGain,cricketGain,cricketDrift,buffer,enabled=false,active=false;
  let rainLevel=1,insectLevel=0,drumTimer=null,drumBeat=0;
  const live=()=>!!context&&enabled&&active;
  function init() {
    const Audio=globalThis.AudioContext || globalThis.webkitAudioContext; if(!Audio) return false;
    if(context)return true;
    context=new Audio();master=context.createGain();master.gain.value=0;master.connect(context.destination);
    buffer=context.createBuffer(1,context.sampleRate*3,context.sampleRate);
    const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    function bed(freq,type,level,Q) {
      const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
      const filter=context.createBiquadFilter();filter.type=type;filter.frequency.value=freq;if(Q)filter.Q.value=Q;
      const gain=context.createGain();gain.gain.value=level;source.connect(filter).connect(gain).connect(master);source.start();return gain;
    }
    windGain=bed(400,'lowpass',.12);rainGain=bed(1800,'highpass',.018*rainLevel);
    // Crickets: a narrow band of noise near 4 kHz, gated at ~15 Hz (the wing
    // stroke), grouped into chirps by a slower gate, and drifting in level so
    // the field never sounds like one insect. Chain: noise → bandpass →
    // stroke gate → chirp gate → level (with drift) → master.
    const src=context.createBufferSource();src.buffer=buffer;src.loop=true;src.playbackRate.value=1.17;
    const band=context.createBiquadFilter();band.type='bandpass';band.frequency.value=4100;band.Q.value=9;
    const stroke=context.createGain();stroke.gain.value=.5;
    const strokeOsc=context.createOscillator();strokeOsc.type='square';strokeOsc.frequency.value=15;
    const strokeDepth=context.createGain();strokeDepth.gain.value=.5;strokeOsc.connect(strokeDepth).connect(stroke.gain);strokeOsc.start();
    const chirp=context.createGain();chirp.gain.value=.4;
    const chirpOsc=context.createOscillator();chirpOsc.type='sine';chirpOsc.frequency.value=2.3;
    const chirpDepth=context.createGain();chirpDepth.gain.value=.6;chirpOsc.connect(chirpDepth).connect(chirp.gain);chirpOsc.start();
    cricketGain=context.createGain();cricketGain.gain.value=0;
    const driftOsc=context.createOscillator();driftOsc.type='sine';driftOsc.frequency.value=.09;
    cricketDrift=context.createGain();cricketDrift.gain.value=0;driftOsc.connect(cricketDrift).connect(cricketGain.gain);driftOsc.start();
    src.connect(band).connect(stroke).connect(chirp).connect(cricketGain).connect(master);src.start();
    setInsects(insectLevel,0);
    return true;
  }
  function volume(){if(context)master.gain.setTargetAtTime(enabled&&active?.5:0,context.currentTime,.12);}
  function setInsects(level,tc=.6) {
    insectLevel=level;
    if(!cricketGain)return;
    const t=context.currentTime;
    cricketGain.gain.setTargetAtTime(.032*level,t,tc);
    cricketDrift.gain.setTargetAtTime(.014*level,t,tc);
  }
  function setRain(level,tc=.4) {
    rainLevel=level;
    if(rainGain)rainGain.gain.setTargetAtTime(.006+.024*level,context.currentTime,tc);
  }
  // Filtered burst of the shared noise buffer. Every one-shot below is built
  // from this and from tone(); both clean up their nodes when they end.
  function noise(duration,freq,level,endFreq,Q=.7,type='bandpass',at=0) {
    if(!live())return;
    const t=context.currentTime+at,source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    source.buffer=buffer;source.loop=true;filter.type=type;filter.frequency.setValueAtTime(freq,t);filter.Q.value=Q;
    if(endFreq)filter.frequency.exponentialRampToValueAtTime(endFreq,t+duration);
    gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(level,t+.012);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
    source.connect(filter).connect(gain).connect(master);source.start(t);source.stop(t+duration+.02);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  function tone(duration,freq,level,{type='sine',endFreq,attack=.004,detune=0,at=0}={}) {
    if(!live())return;
    const t=context.currentTime+at,osc=context.createOscillator(),gain=context.createGain();
    osc.type=type;osc.frequency.setValueAtTime(freq,t);osc.detune.value=detune;
    if(endFreq)osc.frequency.exponentialRampToValueAtTime(endFreq,t+duration);
    gain.gain.setValueAtTime(.0005,t);gain.gain.linearRampToValueAtTime(level,t+attack);gain.gain.exponentialRampToValueAtTime(.0005,t+duration);
    osc.connect(gain).connect(master);osc.start(t);osc.stop(t+duration+.02);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  // A struck temple bell: inharmonic partials, the hum lasting longest, and
  // a short strike transient. `base` is the hum in Hz, `at` an offset in s.
  function strikeBell(base=164,at=0,level=1) {
    if(!live())return;
    const partials=[[1,4.6,.34],[2.0,3.4,.20],[2.42,2.9,.15],[3.09,2.1,.13],[4.2,1.5,.08],[5.43,.9,.05]];
    for(const [ratio,decay,amp] of partials) tone(decay,base*ratio,amp*level,{attack:.006,at});
    noise(.05,1400,.16*level,600,1.2,'bandpass',at);
  }
  function taiko(accent) {
    tone(.55,64,accent?.55:.36,{endFreq:44,attack:.006});
    noise(.14,260,accent?.20:.12,120,.8,'lowpass');
  }
  function stopDrum(){if(drumTimer){clearInterval(drumTimer);drumTimer=null;}drumBeat=0;}
  return {
    setEnabled(value){enabled=value;if(value&&init())context.resume().catch(()=>{});volume();return enabled;},
    setActive(value){active=value;if(value&&context&&enabled)context.resume().catch(()=>{});volume();},
    // wind 0..1 drives the wind bed; rain 0..1 (optional) scales the rain bed
    // so the sound follows the visible rain.
    update(wind,rain){
      if(!context)return;
      if(windGain)windGain.gain.setTargetAtTime(.07+wind*.08,context.currentTime,.3);
      if(rain!==undefined&&Math.abs(rain-rainLevel)>.01)setRain(rain);
    },
    // Per-frame ambience levels: { rain: 0..1, insects: 0..1 }. Cheap to call
    // every frame; only a changed level touches the graph.
    ambience({rain,insects}={}){
      if(rain!==undefined&&Math.abs(rain-rainLevel)>.01)setRain(rain);
      if(insects!==undefined&&Math.abs(insects-insectLevel)>.01)setInsects(insects);
    },
    step(stone=true,run=false){noise(.10,stone?220:650,run?.17:.10);noise(.07,2800,.015);},
    sword(){noise(.24,1800,.15,260);},
    draw(){noise(.32,2500,.07,950);},
    // A blade landing: a low thud with a bright transient on top.
    hit(){tone(.20,96,.48,{endFreq:42,attack:.003});noise(.035,3400,.26,1600,1.4);noise(.12,420,.14,180,.9,'lowpass');},
    // Steel on steel: two detuned partials ringing off fast, and a spark.
    parry(){tone(.34,1960,.20,{attack:.002});tone(.30,1960,.16,{detune:23,attack:.002});tone(.18,3120,.09,{attack:.002});noise(.03,5600,.20,2400,2);},
    // A blade taken on the guard: a dull clack, no ring.
    guard(){noise(.06,900,.30,500,2.2);tone(.08,190,.22,{endFreq:120,attack:.003});},
    // Footing lost: a wobbling low tone under a scuff of noise.
    stagger(){tone(.36,150,.26,{endFreq:68,attack:.008});tone(.22,150,.12,{detune:-90,endFreq:60,attack:.02,at:.05});noise(.30,380,.12,140,.8,'lowpass');},
    // A body falling: a long low drop and a rush of noise, then the ground.
    death(){tone(.9,112,.42,{endFreq:36,attack:.01});noise(.8,520,.18,140,.9);tone(.22,80,.36,{endFreq:40,attack:.003,at:.5});noise(.1,300,.16,120,.8,'lowpass',.5);},
    // The standoff cue: a sharp, short tick.
    flinch(){noise(.025,6000,.34,4000,3);tone(.02,1240,.12,{type:'square',attack:.001});},
    // A slow taiko pulse (~54 bpm) while `start` is true; stopped otherwise.
    standoffDrum(start){
      if(!start){stopDrum();return;}
      if(drumTimer||!live())return;
      taiko(true);drumBeat=1;
      drumTimer=setInterval(()=>{if(!live()){stopDrum();return;}taiko(drumBeat%2===0);drumBeat++;},60000/54);
    },
    bell(){strikeBell(164,0,1);},
    // Three ascending strikes.
    victory(){strikeBell(164,0,.9);strikeBell(196,.55,.9);strikeBell(246,1.1,1);},
    dispose(){stopDrum();context?.close().catch(()=>{});},
  };
}
