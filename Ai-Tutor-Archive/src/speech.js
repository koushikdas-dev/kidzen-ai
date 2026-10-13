import { base64 } from './media.js';
const encoder=new TextEncoder();
const b64url=bytes=>base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(env,uses){return crypto.subtle.importKey('raw',encoder.encode('kidzen-speech-signing-v1:'+(env.OPENAI_API_KEY || env.GPT_API)),{name:'HMAC',hash:'SHA-256'},false,uses);}
export async function issueSpeechToken(env,sub,text,language) {
 const payload=b64url(encoder.encode(JSON.stringify({purpose:'tutor-speech-v1',sub,text,language,exp:Math.floor(Date.now()/1000)+600})));
 const signature=await crypto.subtle.sign('HMAC',await key(env,['sign']),encoder.encode(payload));return payload+'.'+b64url(new Uint8Array(signature));
}
export async function verifySpeechToken(env,sub,token) {
 try {
  if(typeof token!=='string' || token.length>14000)return null;const parts=token.split('.');if(parts.length!==2)return null;
  if(!await crypto.subtle.verify('HMAC',await key(env,['verify']),decode(parts[1]),encoder.encode(parts[0])))return null;
  const p=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(p.purpose!=='tutor-speech-v1' || p.sub!==sub || !Number.isInteger(p.exp) || p.exp<=Math.floor(Date.now()/1000) || typeof p.text!=='string' || !p.text || p.text.length>1800 || !['en','hi','bn'].includes(p.language))return null;return p;
 }catch{return null;}
}
const VOICES=['coral','marin','cedar','nova','shimmer','alloy'];
export async function synthesize(env,text,language,fetcher=fetch) {
 const voice=VOICES.includes(env.TTS_VOICE)?env.TTS_VOICE:'coral';
 const res=await fetcher('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY || env.GPT_API}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.TTS_MODEL || 'gpt-4o-mini-tts',voice,input:text,response_format:'mp3',instructions:`Read exactly the supplied text in ${ {en:'English',hi:'Hindi',bn:'Bengali'}[language] }. Use a cheerful, light, gentle storybook voice suitable for children aged 3 to 8. Speak slowly and clearly with warm expression and short pauses. No extra words or sound effects. Do not imitate a real child or person.`}),signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Error('speech_unavailable');const bytes=new Uint8Array(await res.arrayBuffer());if(!bytes.length || bytes.length>3*1024*1024)throw Error('speech_unavailable');return bytes;
}
export async function transcribe(env,wav,language,fetcher=fetch) {
 const form=new FormData();form.set('file',new Blob([wav],{type:'audio/wav'}),'question.wav');form.set('model',env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');form.set('response_format','json');form.set('language',language);
 const res=await fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY || env.GPT_API}`},body:form,signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Error('transcription_unavailable');const body=await res.json();if(typeof body.text!=='string')throw Error('transcription_unavailable');return body.text.trim();
}
