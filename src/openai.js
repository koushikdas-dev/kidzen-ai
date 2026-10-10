import { ANSWER_SCHEMA, REVIEW_SCHEMA, TUTOR_POLICY, REVIEW_POLICY } from './policy.js';
async function post(env, path, body, fetcher) {
 const response=await fetcher(`https://api.openai.com/v1/${path}`, {
  method:'POST', headers:{Authorization:`Bearer ${env.OPENAI_API_KEY || env.GPT_API}`,'Content-Type':'application/json'},
  body:JSON.stringify(body), signal:AbortSignal.timeout(25000)
 });
 if(!response.ok) throw new Error('upstream_unavailable');
 return response.json();
}
export async function moderate(env, text, fetcher=fetch) {
 const result=await post(env,'moderations',{model:'omni-moderation-latest',input:text},fetcher);
 const item=result.results?.[0];
 if(typeof item?.flagged!=='boolean' || !item.categories || typeof item.categories!=='object') throw new Error('invalid_moderation');
 return item;
}
async function structured(env, model, instructions, input, schema, name, fetcher, image) {
 const {image:ignoredImage,...textInput}=input;
 const result=await post(env,'responses',{
  model,store:false,instructions,input:image ? [{role:'user',content:[{type:'input_text',text:JSON.stringify(textInput)},{type:'input_image',image_url:image.url,detail:'low'}]}] : JSON.stringify(textInput),max_output_tokens:2000,
  text:{format:{type:'json_schema',name,strict:true,schema}}
 },fetcher);
 if(result.status!=='completed') throw new Error('incomplete_output');
 const parts=(result.output || []).filter(x=>x.type==='message' && x.role==='assistant').flatMap(x=>x.content || []);
 if(parts.some(x=>x.type==='refusal')) throw new Error('refused_output');
 const text=parts.filter(x=>x.type==='output_text').map(x=>x.text).join('');
 return JSON.parse(text);
}
export function generate(env, data, inputModeration, fetcher=fetch) {
 return structured(env,env.TUTOR_MODEL,TUTOR_POLICY,{...data,moderation_categories:inputModeration.categories},ANSWER_SCHEMA,'tutor_answer',fetcher,data.image);
}
export function review(env, data, candidate, fetcher=fetch) {
 return structured(env,env.SAFETY_MODEL,REVIEW_POLICY,{...data,candidate},REVIEW_SCHEMA,'child_safety_review',fetcher,data.image);
}
