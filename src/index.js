import { GRADES, LANGUAGES, SUGGESTIONS, fallback, hasBlockedWords, hasPrivateDetails, urgentDisclosure } from './policy.js';
import { verifyAppKey } from './auth.js';
import { moderate, generate, review } from './openai.js';
import { boundedBytes, parseUpload, base64, RequestError } from './media.js';
import { transcribe, issueSpeechToken, verifySpeechToken, synthesize } from './speech.js';
import { VISUAL_IDS, visualDescriptor, visualSvg } from './visuals.js';
export { TutorLimiter } from './limiter.js';
function validate(body) {
 if(!body || typeof body!=='object' || Array.isArray(body))throw new RequestError(400,'invalid_body');
 if(Object.keys(body).some(k=>!['message','grade','language','history','visual_mode'].includes(k)))throw new RequestError(400,'unknown_field');
 const {message,grade='nursery',language='en',history=[],visual_mode='auto'}=body;
 if(typeof message!=='string' || !message.trim() || message.length>1000)throw new RequestError(400,'invalid_message');
 if(!GRADES.includes(grade) || !Object.hasOwn(LANGUAGES,language) || !['auto','none'].includes(visual_mode))throw new RequestError(400,'invalid_profile');
 if(!Array.isArray(history) || history.length>8)throw new RequestError(400,'invalid_history');
 for(const item of history)if(!item || !['user','assistant'].includes(item.role) || typeof item.content!=='string' || !item.content.trim() || item.content.length>1000 || Object.keys(item).some(k=>!['role','content'].includes(k)))throw new RequestError(400,'invalid_history');
 return {message:message.trim(),grade,language,history,visual_mode};
}
async function readBody(request) {
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new RequestError(415,'json_required');
 const bytes=await boundedBytes(request,16384);
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new RequestError(400,'invalid_json');}
}
function validCandidate(c) {
 return c && Object.keys(c).every(k=>['answer','follow_up','needs_adult_help','visual_id'].includes(k)) && typeof c.answer==='string' && c.answer.trim().length>0 && c.answer.length<=1800 && typeof c.follow_up==='string' && c.follow_up.length<=250 && typeof c.needs_adult_help==='boolean' && (c.visual_id===undefined || VISUAL_IDS.includes(c.visual_id));
}
export function createWorker(fetcher=fetch) {
 return {async fetch(request,env) {
  const id=crypto.randomUUID(),origin=request.headers.get('Origin');
  const origins=(env.ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin','X-Request-Id':id};
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(origin && !origins.includes(origin))return json({success:false,error:'origin_not_allowed'},403);
  if(origin)headers['Access-Control-Allow-Origin']=origin;
  headers['Access-Control-Expose-Headers']='X-Request-Id, Retry-After';headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='X-App-Key, X-User-Id, Content-Type';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const path=new URL(request.url).pathname;
  if(path==='/health' && request.method==='GET')return json({success:true,service:'kidzen-students-ai-tutor',version:'2.2.0'});
  const visualId=path.match(/^\/v1\/tutor\/visuals\/([a-z]+)\.svg$/)?.[1];
  if(visualId && request.method==='GET') {
   const svg=visualSvg(visualId);if(svg)return new Response(svg,{headers:{...headers,'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=86400','Content-Security-Policy':"default-src 'none'; style-src 'none'; sandbox"}});
  }
  const routes={'/v1/tutor/config':'GET','/v1/tutor/suggestions':'GET','/v1/tutor/chat':'POST','/chat':'POST','/v1/tutor/voice-chat':'POST','/v1/tutor/photo-chat':'POST','/v1/tutor/speech':'POST'};
  if(!Object.hasOwn(routes,path))return json({success:false,error:'endpoint_not_found'},404);
  if(routes[path]!==request.method){headers.Allow=routes[path];return json({success:false,error:'method_not_allowed'},405);}
  if(!env.TUTOR_APP_KEY || env.TUTOR_APP_KEY.length<16)return json({success:false,error:'app_key_not_configured'},503);
  if(!await verifyAppKey(request,env))return json({success:false,error:'invalid_app_key'},401);
  const userId=request.headers.get('X-User-Id');
  if(!userId || !/^[A-Za-z0-9_-]{1,128}$/.test(userId))return json({success:false,error:'user_id_required'},400);
  // Client-supplied UID is used only for quotas, never proof of identity/payment.
  // Hash it before naming a counter so raw Google/Firebase IDs are not stored.
  const uidHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(userId));
  const identity={sub:Array.from(new Uint8Array(uidHash),b=>b.toString(16).padStart(2,'0')).join('')};
  if(path==='/v1/tutor/config')return json({success:true,data:{grades:GRADES,languages:LANGUAGES,max_message_characters:1000,max_history_messages:8,media:{voice_questions:env.OPENAI_AUDIO_CONFIRMED==='true',photo_questions:env.PHOTO_UPLOAD_SAFEGUARDS_CONFIRMED==='true',audio_replies:env.OPENAI_AUDIO_CONFIRMED==='true',audio_format:'mono_16000hz_pcm16_wav',max_audio_seconds:45,max_photo_bytes:2097152,photo_types:['image/jpeg','image/png'],illustrations_per_day:3},disclosure:'I am an AI learning helper. My voice is made by AI. I can make mistakes. Ask a trusted grown-up when you need help.'}});
  if(path==='/v1/tutor/suggestions') {
   const language=new URL(request.url).searchParams.get('language') || 'en';if(!Object.hasOwn(LANGUAGES,language))return json({success:false,error:'invalid_language'},400);
   return json({success:true,data:{questions:SUGGESTIONS[language]}});
  }
  const isSpeech=path==='/v1/tutor/speech',isPhoto=path==='/v1/tutor/photo-chat',isVoice=path==='/v1/tutor/voice-chat';
  let data,upload,speech;
  try {
   if(isSpeech) {
    const b=await readBody(request);if(!b || Object.keys(b).length!==1 || typeof b.speech_token!=='string')throw new RequestError(400,'speech_token_required');
    speech=await verifySpeechToken(env,identity.sub,b.speech_token);if(!speech)throw new RequestError(401,'invalid_speech_token');
   }else if(isVoice || isPhoto) {
    upload=await parseUpload(request,path);
    // Validate profile/history before any paid call, including transcription.
    const defaultQuestion={en:'What can you see in this picture?',hi:'इस तस्वीर में क्या दिख रहा है?',bn:'এই ছবিতে কী দেখা যাচ্ছে?'}[upload.fields.language || 'en'] || 'What is in this picture?';
    data=validate({...upload.fields,message:upload.audio?'Spoken question':upload.fields.message || defaultQuestion});
   }else data=validate(await readBody(request));
  }catch(e){return json({success:false,error:e instanceof RequestError?e.message:'invalid_body'},e.status || 400);}
  if(env.OPENAI_ZDR_CONFIRMED!=='true' || !(env.OPENAI_API_KEY || env.GPT_API) || !env.TUTOR_MODEL || !env.SAFETY_MODEL || !env.TUTOR_LIMITER)return json({success:false,error:'child_service_setup_required'},503);
  if((isSpeech || upload?.audio) && env.OPENAI_AUDIO_CONFIRMED!=='true')return json({success:false,error:'audio_setup_required'},503);
  if(isPhoto && env.PHOTO_UPLOAD_SAFEGUARDS_CONFIRMED!=='true')return json({success:false,error:'photo_safeguards_setup_required'},503);
  const limiter=()=>env.TUTOR_LIMITER.get(env.TUTOR_LIMITER.idFromName(identity.sub));
  const permitted=async url=>{const res=await limiter().fetch(url);const result=await res.json();if(!res.ok || typeof result.allowed!=='boolean')throw Error('limiter_unavailable');return result.allowed;};
  const result=async(answer,status='answered',visual=null)=>{
   const token=env.OPENAI_AUDIO_CONFIRMED==='true'?await issueSpeechToken(env,identity.sub,answer.answer,data.language):null;
   return json({success:true,request_id:id,data:{...answer,grade:data.grade,language:data.language,status,visual,speech:token?{token,endpoint:'/v1/tutor/speech',format:'mp3',expires_in_seconds:600,disclosure:'AI-generated voice'}:null}});
  };
  try {
   const kind=isSpeech?'speech':isPhoto?'photo':isVoice?'voice':'chat';
   if(!await permitted('https://limiter.internal/check?kind='+kind)){headers['Retry-After']='60';return json({success:false,error:'rate_limit_exceeded'},429);}
   if(isSpeech) {
    try {const bytes=await synthesize(env,speech.text,speech.language,fetcher);return new Response(bytes,{headers:{...headers,'Content-Type':'audio/mpeg','X-Audio-Disclosure':'AI-generated voice'}});}
    catch{return json({success:false,error:'speech_temporarily_unavailable'},503);}
   }
   if(upload?.audio) {
    data.message=await transcribe(env,upload.audio,data.language,fetcher);
    if(!data.message || data.message.length>1000)return json({success:false,error:'please_record_a_short_clear_question'},422);
   }
   const allText=[...data.history.map(x=>x.content),data.message].join('\n');
   if(urgentDisclosure(allText))return await result(fallback('adult',data.language,true),'adult_help');
   if(hasPrivateDetails(allText))return await result(fallback('privacy',data.language),'privacy_reminder');
   if(upload?.image) {
    data.image={url:`data:${upload.image.mime};base64,${base64(upload.image.bytes)}`};
    const photoCheck=await moderate(env,[{type:'text',text:allText},{type:'image_url',image_url:{url:data.image.url}}],fetcher);
    if(photoCheck.flagged)return await result(fallback(photoCheck.categories['sexual/minors']?'adult':'safe',data.language,!!photoCheck.categories['sexual/minors']),'safe_alternative');
   }
   const input=await moderate(env,allText,fetcher),c=input.categories;
   if(c['sexual/minors'] || c['self-harm/intent'] || c['self-harm/instructions'] || c['hate/threatening'] || c['harassment/threatening'])return await result(fallback('adult',data.language,true),'adult_help');
   const candidate=await generate(env,data,input,fetcher);
   if(!validCandidate(candidate) || hasBlockedWords(candidate.answer+' '+candidate.follow_up) || hasPrivateDetails(candidate.answer+' '+candidate.follow_up) || /https?:\/\/|www\./i.test(candidate.answer+' '+candidate.follow_up))return await result(fallback(candidate?.needs_adult_help===true?'adult':'safe',data.language,candidate?.needs_adult_help===true),'safe_alternative');
   const output=await moderate(env,candidate.answer+'\n'+candidate.follow_up,fetcher),verdict=await review(env,data,candidate,fetcher);
   if(typeof verdict?.safe!=='boolean' || typeof verdict?.needs_adult_help!=='boolean')throw Error('invalid_review');
   const adult=candidate.needs_adult_help || verdict.needs_adult_help;
   if(output.flagged || !verdict.safe)return await result(fallback(adult?'adult':'safe',data.language,adult),adult?'adult_help':'safe_alternative');
   let visual=null;
   if(!adult && data.visual_mode==='auto' && candidate.visual_id && candidate.visual_id!=='none') {
    // Visual quota failure must never discard an already checked text answer.
    try{if(await permitted('https://limiter.internal/visual'))visual=visualDescriptor(candidate.visual_id,data.language);}catch{}
   }
   return await result({answer:candidate.answer,follow_up:adult?'':candidate.follow_up,needs_adult_help:adult},adult?'adult_help':'answered',visual);
  }catch{
   return json({success:false,error:'tutor_temporarily_unavailable',request_id:id,data:{...fallback('unavailable',data.language),status:'unavailable',grade:data.grade,language:data.language,visual:null,speech:null}},503);
  }
 }};
}
export default createWorker();
