// Bounded upload parsing, accepted WAV format, and metadata stripping.
export class RequestError extends Error { constructor(status,code) {super(code);this.status=status;} }
export async function boundedBytes(request,max) {
 if(Number(request.headers.get('Content-Length'))>max) throw new RequestError(413,'body_too_large');
 const reader=request.body?.getReader();if(!reader) throw new RequestError(400,'empty_body');
 const chunks=[];let size=0;
 while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new RequestError(413,'body_too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return bytes;
}
export async function multipart(request) {
 const type=request.headers.get('Content-Type') || '';
 if(!type.startsWith('multipart/form-data;')) throw new RequestError(415,'multipart_required');
 const bytes=await boundedBytes(request,4*1024*1024);
 try { return await new Response(bytes,{headers:{'Content-Type':type}}).formData(); } catch {throw new RequestError(400,'invalid_multipart');}
}
export function canonicalWav(bytes) {
 const fail=()=>{throw new RequestError(400,'audio_must_be_mono_16khz_pcm16_wav_up_to_45_seconds');};
 if(bytes.length<44 || bytes.length>1500000) fail();
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),str=(i,n)=>String.fromCharCode(...bytes.slice(i,i+n));
 if(str(0,4)!=='RIFF' || str(8,4)!=='WAVE' || dv.getUint32(4,true)!==bytes.length-8) fail();
 let fmt=null,data=null;
 for(let at=12;at+8<=bytes.length;) {
  const name=str(at,4),len=dv.getUint32(at+4,true),end=at+8+len;if(end>bytes.length)fail();
  if(name==='fmt ') {if(fmt || len<16)fail();fmt=bytes.slice(at+8,at+24);}
  if(name==='data') {if(data)fail();data=bytes.slice(at+8,end);}
  at=end+(len%2);
 }
 if(!fmt || !data || !data.length)fail();const f=new DataView(fmt.buffer);
 if(f.getUint16(0,true)!==1 || f.getUint16(2,true)!==1 || f.getUint32(4,true)!==16000 || f.getUint32(8,true)!==32000 || f.getUint16(12,true)!==2 || f.getUint16(14,true)!==16 || data.length%2 || data.length/32000>45)fail();
 const out=new Uint8Array(44+data.length),v=new DataView(out.buffer),put=(at,s)=>out.set(new TextEncoder().encode(s),at);
 put(0,'RIFF');v.setUint32(4,out.length-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);out.set(fmt,20);put(36,'data');v.setUint32(40,data.length,true);out.set(data,44);return out;
}
function join(chunks){const out=new Uint8Array(chunks.reduce((n,x)=>n+x.length,0));let at=0;for(const x of chunks){out.set(x,at);at+=x.length;}return out;}
export function cleanPhoto(bytes,mime) {
 const fail=()=>{throw new RequestError(400,'invalid_photo');};
 if(!bytes.length || bytes.length>2*1024*1024)throw new RequestError(413,'photo_too_large');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0;const chunks=[];
 if(mime==='image/png') {
  if(bytes.length<33 || bytes.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')fail();chunks.push(bytes.slice(0,8));let ended=false;
  for(let at=8;at+12<=bytes.length;) {
   const len=v.getUint32(at),end=at+12+len;if(end>bytes.length)fail();const name=String.fromCharCode(...bytes.slice(at+4,at+8));
   if(at===8 && (name!=='IHDR' || len!==13))fail();
   if(name==='IHDR'){width=v.getUint32(at+8);height=v.getUint32(at+12);}
   if(['acTL','fcTL','fdAT'].includes(name))fail();
   if(!['tEXt','iTXt','zTXt','eXIf'].includes(name))chunks.push(bytes.slice(at,end));
   at=end;if(name==='IEND'){ended=at===bytes.length;break;}
  }
  if(!ended)fail();
 } else if(mime==='image/jpeg') {
  if(bytes[0]!==255 || bytes[1]!==216)fail();chunks.push(bytes.slice(0,2));let scan=false;
  for(let at=2;at+4<=bytes.length;) {
   if(bytes[at]!==255)fail();const marker=bytes[at+1],len=v.getUint16(at+2),end=at+2+len;if(len<2 || end>bytes.length)fail();
   if([0xc0,0xc1,0xc2].includes(marker)){if(len<8)fail();height=v.getUint16(at+5);width=v.getUint16(at+7);}
   if(marker===0xda){if(bytes.at(-2)!==255 || bytes.at(-1)!==217)fail();chunks.push(bytes.slice(at));scan=true;break;}
   if(![0xe1,0xed,0xfe].includes(marker))chunks.push(bytes.slice(at,end));at=end;
  }
  if(!scan)fail();
 } else throw new RequestError(415,'photo_must_be_jpeg_or_png');
 if(!width || !height || width*height>16000000 || width>8192 || height>8192)fail();
 return join(chunks);
}
export function base64(bytes) {
 let s='';for(let at=0;at<bytes.length;at+=8192)s+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(s);
}
export async function parseUpload(request,path) {
 const form=await multipart(request);const allowed=['grade','language','history','visual_mode','message','audio','image'];
 for(const key of form.keys())if(!allowed.includes(key) || form.getAll(key).length!==1)throw new RequestError(400,'invalid_upload_field');
 const fields={};for(const key of ['grade','language','visual_mode','message'])if(form.has(key)){if(typeof form.get(key)!=='string')throw new RequestError(400,'invalid_upload_field');fields[key]=form.get(key);}
 if(form.has('history')){try{fields.history=JSON.parse(form.get('history'));}catch{throw new RequestError(400,'invalid_history');}}
 const getFile=async key=>{const f=form.get(key);if(!f || typeof f.arrayBuffer!=='function')throw new RequestError(400,key+'_file_required');return {bytes:new Uint8Array(await f.arrayBuffer()),type:f.type};};
 let audio,image;
 if(form.has('audio'))audio=canonicalWav((await getFile('audio')).bytes);
 if(form.has('image')){const f=await getFile('image');image={bytes:cleanPhoto(f.bytes,f.type),mime:f.type};}
 if(path==='/v1/tutor/voice-chat' && (!audio || image || fields.message!==undefined))throw new RequestError(400,'voice_chat_requires_audio_only');
 if(path==='/v1/tutor/photo-chat' && !image)throw new RequestError(400,'photo_required');
 if(audio && fields.message?.trim())throw new RequestError(400,'choose_audio_or_text_question');
 return {fields,audio,image};
}
