function decode(value) {
 if(!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_token');
 return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
}
export async function verifyToken(request, env, now=Math.floor(Date.now()/1000)) {
 try {
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if(!token || token.length>4096) return null;
  const parts=token.split('.'); if(parts.length!==3) return null;
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if(header.alg!=='HS256' || header.typ!=='JWT') return null;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.TUTOR_JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))) return null;
  const p=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(p.iss!==env.TOKEN_ISSUER || p.aud!==env.TOKEN_AUDIENCE || typeof p.sub!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(p.sub)) return null;
  if(!Number.isInteger(p.exp) || !Number.isInteger(p.iat) || p.exp<=now || p.iat>now+30 || p.exp-p.iat>3600 || p.exp<=p.iat) return null;
  if(p.nbf!==undefined && (!Number.isInteger(p.nbf) || p.nbf>now)) return null;
  if(p.guardian_consent!==true) return null;
  return p;
 } catch { return null; }
}
