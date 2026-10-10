// One object per opaque account. Counters only; no chat, media or transcripts.
export class TutorLimiter {
 constructor(state) { this.state=state; }
 async fetch(request='https://limiter.internal/check') {
  const url=new URL(typeof request==='string'?request:request.url);
  const kind=url.searchParams.get('kind') || 'chat';
  const now=Date.now(),minute=Math.floor(now/60000),day=Math.floor(now/86400000);
  const allowed=await this.state.storage.transaction(async storage=>{
   const old=await storage.get('counts') || {};
   const sameDay=old.day===day,m=old.minute===minute?old.m:0,d=sameDay?old.d:0;
   const modes=sameDay?(old.modes || {}):{};
   if(url.pathname==='/visual') {
    const count=modes.visual || 0;if(count>=3)return false;
    await storage.put('counts',{...old,minute,day,m,d,modes:{...modes,visual:count+1}});await storage.setAlarm(now+86400000);return true;
   }
   const cap={chat:100,voice:30,photo:10,speech:20}[kind];if(!cap)return false;
   if(m>=6 || d>=100 || (modes[kind] || 0)>=cap)return false;
   await storage.put('counts',{minute,day,m:m+1,d:d+1,modes:{...modes,[kind]:(modes[kind] || 0)+1}});
   await storage.setAlarm(now+86400000);return true;
  });
  return Response.json({allowed});
 }
 async alarm(){await this.state.storage.deleteAll();}
}
