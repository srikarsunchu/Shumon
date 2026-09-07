// All sounds are synthesized locally; there are no external audio recordings.
export function createTempleAudio() {
  let context,master,windGain,rainGain,buffer,enabled=false,active=false;
  function init() {
    const Audio=globalThis.AudioContext || globalThis.webkitAudioContext; if(!Audio) return false;
    if(context)return true;
    context=new Audio();master=context.createGain();master.gain.value=0;master.connect(context.destination);
    buffer=context.createBuffer(1,context.sampleRate*3,context.sampleRate);
    const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    function bed(freq,type,level) {
      const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
      const filter=context.createBiquadFilter();filter.type=type;filter.frequency.value=freq;
      const gain=context.createGain();gain.gain.value=level;source.connect(filter).connect(gain).connect(master);source.start();return gain;
    }
    windGain=bed(400,'lowpass',.12);rainGain=bed(1800,'highpass',.018);return true;
  }
  function volume(){if(context)master.gain.setTargetAtTime(enabled&&active?.5:0,context.currentTime,.12);}
  function noise(duration,freq,level,endFreq) {
    if(!context||!enabled||!active)return;
    const t=context.currentTime,source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    source.buffer=buffer;filter.type='bandpass';filter.frequency.setValueAtTime(freq,t);filter.Q.value=.7;
    if(endFreq)filter.frequency.exponentialRampToValueAtTime(endFreq,t+duration);
    gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(level,t+.012);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
    source.connect(filter).connect(gain).connect(master);source.start();source.stop(t+duration+.02);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  return {
    setEnabled(value){enabled=value;if(value&&init())context.resume().catch(()=>{});volume();return enabled;},
    setActive(value){active=value;if(value&&context&&enabled)context.resume().catch(()=>{});volume();},
    update(wind){if(windGain)windGain.gain.setTargetAtTime(.07+wind*.08,context.currentTime,.3);},
    step(stone=true,run=false){noise(.10,stone?220:650,run?.17:.10);noise(.07,2800,.015);},
    sword(){noise(.24,1800,.15,260);},
    draw(){noise(.32,2500,.07,950);},
    dispose(){context?.close().catch(()=>{});},
  };
}
