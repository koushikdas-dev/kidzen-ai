// Simple app-level access check. This does not authenticate a Google/Firebase user.
// A shipped app key is extractable; do not treat it as purchase verification.
export async function verifyAppKey(request,env) {
 const supplied=request.headers.get('X-App-Key');
 if(!supplied || supplied.length>512 || !env.TUTOR_APP_KEY)return false;
 const encoder=new TextEncoder();
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),crypto.subtle.digest('SHA-256',encoder.encode(env.TUTOR_APP_KEY))]);
 const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];return difference===0;
}
