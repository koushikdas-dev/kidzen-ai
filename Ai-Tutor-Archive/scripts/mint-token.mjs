// Trusted-server/local-operator tool only. NEVER ship this secret in an app.
import { createHmac, randomBytes } from 'node:crypto';
const secret=process.env.TUTOR_JWT_SECRET;
if(!secret || secret.length<32) throw Error('Set TUTOR_JWT_SECRET (at least 32 characters) on the trusted server.');
if(process.env.GUARDIAN_CONSENT_VERIFIED!=='true') throw Error('Verify guardian consent before minting a token.');
const now=Math.floor(Date.now()/1000);
const sub=process.env.TUTOR_ACCOUNT_ID || randomBytes(16).toString('hex');
if(!/^[A-Za-z0-9_-]{16,128}$/.test(sub)) throw Error('Use an opaque account ID, never a child name or email.');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const data=encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:process.env.TOKEN_ISSUER || 'kidzen-parent-backend',aud:process.env.TOKEN_AUDIENCE || 'kidzen-tutor',sub,iat:now,exp:now+900,guardian_consent:true});
console.log(data+'.'+createHmac('sha256',secret).update(data).digest('base64url'));
