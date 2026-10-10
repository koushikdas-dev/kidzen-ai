import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createWorker} from '../src/index.js';
import {canonicalWav,cleanPhoto} from '../src/media.js';
import {issueSpeechToken,verifySpeechToken} from '../src/speech.js';
import {TutorLimiter} from '../src/limiter.js';
const env={TUTOR_JWT_SECRET:'test-secret-with-32-characters-at-least',TOKEN_ISSUER:'test',TOKEN_AUDIENCE:'test',OPENAI_ZDR_CONFIRMED:'true',OPENAI_AUDIO_CONFIRMED:'true',PHOTO_UPLOAD_SAFEGUARDS_CONFIRMED:'true',OPENAI_API_KEY:'fake',TUTOR_MODEL:'model',SAFETY_MODEL:'review',TTS_MODEL:'gpt-4o-mini-tts',TTS_VOICE:'coral',TUTOR_LIMITER:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({allowed:true})})}};
const sub='opaque-account-test123';
function auth(){const now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const p=enc({alg:'HS256',typ:'JWT'})+'.'+enc({iss:'test',aud:'test',sub,iat:now,exp:now+600,guardian_consent:true});return 'Bearer '+p+'.'+createHmac('sha256',env.TUTOR_JWT_SECRET).update(p).digest('base64url');}
function wav(seconds=1){const bytes=new Uint8Array(44+seconds*32000),v=new DataView(bytes.buffer),s=(i,t)=>bytes.set(new TextEncoder().encode(t),i);s(0,'RIFF');v.setUint32(4,bytes.length-8,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,bytes.length-44,true);return bytes;}
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=','base64'));
function upload(path,{audio=false,image=false,fields={}}={}){const body=new FormData();if(audio)body.set('audio',new Blob([wav()],{type:'audio/wav'}),'q.wav');if(image)body.set('image',new Blob([png],{type:'image/png'}),'p.png');for(const[k,v]of Object.entries(fields))body.set(k,v);return new Request('https://api.example'+path,{method:'POST',headers:{Authorization:auth()},body});}
function jsonReq(path,body){return new Request('https://api.example'+path,{method:'POST',headers:{Authorization:auth(),'Content-Type':'application/json'},body:JSON.stringify(body)});}
const clean={flagged:false,categories:{}};
function provider({transcript='How does a plant grow?',photoFlag=false,visual='plant',badSpeech=false,badTranscript=false,unsafeAnswer=false}={}){
 const calls=[];return {calls,worker:createWorker(async(url,opt)=>{
  calls.push({url,opt});
  if(url.endsWith('/transcriptions')){if(badTranscript)return new Response('error',{status:500});return Response.json({text:transcript});}
  if(url.endsWith('/speech'))return badSpeech?new Response('error',{status:500}):new Response(new Uint8Array([73,68,51,1,2]),{headers:{'Content-Type':'audio/mpeg'}});
  const b=JSON.parse(opt.body);
  if(url.endsWith('/moderations'))return Response.json({results:[Array.isArray(b.input) && photoFlag?{flagged:true,categories:{sexual:true}}:clean]});
  const review=b.text.format.name==='child_safety_review',value=review?{safe:!unsafeAnswer,needs_adult_help:false}:{answer:'Plants need water and sunlight to grow.',follow_up:'',needs_adult_help:false,visual_id:visual};
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 })};
}
test('voice question transcribes once then passes ordinary safety pipeline',async()=>{
 const {worker,calls}=provider();const res=await worker.fetch(upload('/v1/tutor/voice-chat',{audio:true}),env);const body=await res.json();assert.equal(res.status,200);assert.ok(body.data.speech.token);assert.equal(body.data.visual.id,'plant');assert.ok(!JSON.stringify(body).includes('How does a plant grow?'));assert.equal(calls.length,5);assert.ok(calls[0].opt.body instanceof FormData);assert.equal(calls[0].opt.body.get('language'),'en');
});
test('speech reads only signed checked text and returns mp3, not arbitrary client text',async()=>{
 const {worker,calls}=provider();const reply=await (await worker.fetch(jsonReq('/chat',{message:'Tell me about plants.'}),env)).json();
 const res=await worker.fetch(jsonReq('/v1/tutor/speech',{speech_token:reply.data.speech.token}),env);assert.equal(res.status,200);assert.equal(res.headers.get('Content-Type'),'audio/mpeg');const sent=JSON.parse(calls.at(-1).opt.body);assert.equal(sent.input,reply.data.answer);assert.equal(sent.voice,'coral');
 assert.equal((await worker.fetch(jsonReq('/v1/tutor/speech',{text:'arbitrary text'}),env)).status,400);
});
test('speech token tampering, expiry and cross-account use rejected',async()=>{
 const token=await issueSpeechToken(env,sub,'Safe answer','en');assert.ok(await verifySpeechToken(env,sub,token));assert.equal(await verifySpeechToken(env,'other-account',token),null);assert.equal(await verifySpeechToken(env,sub,token+'x'),null);
 const payload=Buffer.from(JSON.stringify({purpose:'tutor-speech-v1',sub,text:'safe',language:'en',exp:1})).toString('base64url');const old=payload+'.'+createHmac('sha256',env.TUTOR_JWT_SECRET).update(payload).digest('base64url');assert.equal(await verifySpeechToken(env,sub,old),null);
});
test('TTS failure leaves previously obtained text usable',async()=>{
 const {worker}=provider({badSpeech:true});const reply=await (await worker.fetch(jsonReq('/chat',{message:'plants'}),env)).json();assert.ok(reply.data.answer);const res=await worker.fetch(jsonReq('/v1/tutor/speech',{speech_token:reply.data.speech.token}),env);assert.equal(res.status,503);assert.equal((await res.json()).error,'speech_temporarily_unavailable');
});
test('unsafe spoken transcript is not echoed and gets trusted adult guidance locally',async()=>{
 const {worker,calls}=provider({transcript:'Someone is touching my private parts.'});const body=await (await worker.fetch(upload('/v1/tutor/voice-chat',{audio:true}),env)).json();assert.equal(body.data.status,'adult_help');assert.equal(calls.length,1);assert.equal(body.data.visual,null);assert.ok(body.data.speech.token);assert.ok(!body.data.answer.includes('private parts'));
});
test('blank/long audio transcription rejected and transcription failure fails closed',async()=>{
 for(const options of [{transcript:''},{transcript:'a'.repeat(1001)},{badTranscript:true}]){const {worker}=provider(options);const res=await worker.fetch(upload('/v1/tutor/voice-chat',{audio:true}),env);assert.equal(res.status,options.badTranscript?503:422);}
});
test('photo is moderated and included in both tutor and contextual reviewer',async()=>{
 const {worker,calls}=provider();const body=await (await worker.fetch(upload('/v1/tutor/photo-chat',{image:true}),env)).json();assert.equal(body.data.status,'answered');assert.equal(calls.length,5);const moderation=JSON.parse(calls[0].opt.body);assert.equal(moderation.input[1].type,'image_url');
 const models=calls.filter(x=>x.url.endsWith('/responses'));assert.equal(models.length,2);for(const call of models){const b=JSON.parse(call.opt.body);assert.equal(b.input[0].content[1].type,'input_image');assert.equal(b.input[0].content[1].detail,'low');assert.ok(!b.input[0].content[0].text.includes('base64,'));}
 assert.ok(!JSON.stringify(body).includes('base64,'));
});
test('flagged photo never reaches vision generation',async()=>{
 const {worker,calls}=provider({photoFlag:true});const body=await (await worker.fetch(upload('/v1/tutor/photo-chat',{image:true}),env)).json();assert.equal(body.data.status,'safe_alternative');assert.equal(calls.length,1);assert.equal(body.data.visual,null);
});
test('photo plus spoken question uses one transcription and checked vision response',async()=>{
 const {worker,calls}=provider();const res=await worker.fetch(upload('/v1/tutor/photo-chat',{image:true,audio:true,fields:{language:'hi'}}),env);assert.equal(res.status,200);assert.equal(calls[0].opt.body.get('language'),'hi');assert.equal(calls.length,6);
});
test('media setup gates stop all paid calls; invalid upload/profile rejected first',async()=>{
 const {worker,calls}=provider();assert.equal((await worker.fetch(upload('/v1/tutor/voice-chat',{audio:true}),{...env,OPENAI_AUDIO_CONFIRMED:'false'})).status,503);assert.equal((await worker.fetch(upload('/v1/tutor/photo-chat',{image:true}),{...env,PHOTO_UPLOAD_SAFEGUARDS_CONFIRMED:'false'})).status,503);
 assert.equal((await worker.fetch(upload('/v1/tutor/voice-chat',{audio:true,fields:{grade:'class_9'}}),env)).status,400);assert.equal((await worker.fetch(upload('/v1/tutor/photo-chat',{}),env)).status,400);assert.equal((await worker.fetch(upload('/v1/tutor/photo-chat',{audio:true,image:true,fields:{message:'text too'}}),env)).status,400);assert.equal(calls.length,0);
});
test('visual opt-out, unknown visual and rejected answer never emit illustration',async()=>{
 for(const options of [{},{visual:'untrusted-url'},{unsafeAnswer:true}]){const {worker}=provider(options);const body=await (await worker.fetch(jsonReq('/chat',{message:'plants',visual_mode:'none'}),env)).json();assert.equal(body.data.visual,null);}
});
test('illustration limit failure preserves approved answer',async()=>{
 const {worker}=provider();const altered={...env,TUTOR_LIMITER:{idFromName:x=>x,get:()=>({fetch:async url=>Response.json({allowed:!url.includes('/visual')})})}};const body=await (await worker.fetch(jsonReq('/chat',{message:'plants'}),altered)).json();assert.equal(body.data.status,'answered');assert.equal(body.data.visual,null);
});
test('curated SVG public route has no scripts and unknown ID is rejected',async()=>{
 const {worker,calls}=provider();const res=await worker.fetch(new Request('https://api.example/v1/tutor/visuals/plant.svg'),env);assert.equal(res.headers.get('Content-Type'),'image/svg+xml');assert.ok(!(await res.text()).includes('<script'));assert.equal((await worker.fetch(new Request('https://api.example/v1/tutor/visuals/unknown.svg'),env)).status,404);assert.equal(calls.length,0);
});
test('WAV duration/rate/file signature validation and photo type limits',()=>{
 assert.equal(canonicalWav(wav()).length,32044);assert.throws(()=>canonicalWav(wav(46)));const bad=wav();new DataView(bad.buffer).setUint32(24,48000,true);assert.throws(()=>canonicalWav(bad));assert.throws(()=>canonicalWav(new Uint8Array([1,2])));assert.throws(()=>cleanPhoto(png,'image/webp'));assert.throws(()=>cleanPhoto(new Uint8Array(3*1024*1024),'image/png'));
});
test('PNG text metadata is stripped before upstream upload',()=>{
 const tag=new TextEncoder().encode('tEXt'),data=new TextEncoder().encode('Location\u0000private address');const chunk=new Uint8Array(12+data.length);new DataView(chunk.buffer).setUint32(0,data.length);chunk.set(tag,4);chunk.set(data,8);const modified=new Uint8Array(png.length+chunk.length);modified.set(png.slice(0,33));modified.set(chunk,33);modified.set(png.slice(33),33+chunk.length);assert.deepEqual(cleanPhoto(modified,'image/png'),png);
});
test('durable modality quotas and three illustrations/day are independent of text release',async()=>{
 const map=new Map();const storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),setAlarm:async()=>{},transaction:async fn=>fn(storage)};const l=new TutorLimiter({storage});for(let i=0;i<3;i++)assert.equal((await (await l.fetch('https://limiter.internal/visual')).json()).allowed,true);assert.equal((await (await l.fetch('https://limiter.internal/visual')).json()).allowed,false);
 const now=Date.now();map.set('counts',{day:Math.floor(now/86400000),minute:Math.floor(now/60000)-1,m:0,d:20,modes:{speech:20}});assert.equal((await (await l.fetch('https://limiter.internal/check?kind=speech')).json()).allowed,false);assert.equal((await (await l.fetch('https://limiter.internal/check?kind=chat')).json()).allowed,true);
});
