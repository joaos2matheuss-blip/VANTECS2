'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL, URLSearchParams } = require('node:url');
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECRET = process.env.SESSION_SECRET || '';
const STEAM_KEY = process.env.STEAM_API_KEY || '';
const PROD = process.env.NODE_ENV === 'production';
if (PROD && (SECRET.length < 32 || !BASE_URL.startsWith('https://'))) {
  console.error('Produção exige SESSION_SECRET (32+ caracteres) e BASE_URL https.'); process.exit(1);
}
if (!SECRET) console.warn('SESSION_SECRET ausente: reinício derrubará sessões. Configure no .env (ver README).');
const sessionKey = SECRET || crypto.randomBytes(32).toString('hex');
const origin = new URL(BASE_URL);
const secure = origin.protocol === 'https:';
const cookieName = 'vanta_session';
const nonceName = 'vanta_login';
function sign(s) {return crypto.createHmac('sha256', sessionKey).update(s).digest('base64url')}
function encode(payload) {const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${sign(p)}`}
function decode(value) {if (!value) return null; const [p,s] = value.split('.');if (!p || !s) return null;const expected = sign(p); if (s.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected)))return null;try {const obj=JSON.parse(Buffer.from(p,'base64url').toString()); return obj.exp > Date.now()?obj:null}catch{return null}}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim()]}))}
function makeCookie(name,value,maxAge){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`}
function json(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(data))}
function redirect(res,url,headers={}){res.writeHead(302,{Location:url,'Cache-Control':'no-store',...headers});res.end()}
async function fetchJson(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),9000);try {const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'VANTA-CS2/3.0'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
async function steamProfile(steamid){if(!STEAM_KEY)return {steamid,personaname:`Steam ${steamid.slice(-6)}`,profileurl:`https://steamcommunity.com/profiles/${steamid}/`,avatarfull:null,profileLimited:true};try{const j=await fetchJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(STEAM_KEY)}&steamids=${steamid}`);return j.response?.players?.[0]||{steamid,personaname:'Jogador Steam',profileLimited:true}}catch{return {steamid,personaname:'Jogador Steam',profileLimited:true}}}
const index = fs.readFileSync(path.join(__dirname,'index.html'));
const server = http.createServer(async (req,res)=>{
  try{
    const url = new URL(req.url,BASE_URL);
    const c=cookies(req);
    if (req.method==='GET' && url.pathname==='/auth/steam'){
      const state=crypto.randomBytes(20).toString('hex');
      const endpoint = new URL('https://steamcommunity.com/openid/login');
      const params = {'openid.ns':'http://specs.openid.net/auth/2.0','openid.mode':'checkid_setup','openid.return_to':`${BASE_URL}/auth/steam/callback?state=${state}`,'openid.realm':BASE_URL+'/','openid.identity':'http://specs.openid.net/auth/2.0/identifier_select','openid.claimed_id':'http://specs.openid.net/auth/2.0/identifier_select'};
      Object.entries(params).forEach(([k,v])=>endpoint.searchParams.set(k,v));
      return redirect(res,endpoint.toString(),{'Set-Cookie':makeCookie(nonceName,encode({state,exp:Date.now()+10*60*1000}),600)});
    }
    if(req.method==='GET' && url.pathname==='/auth/steam/callback'){
      const saved=decode(c[nonceName]);
      const clear={'Set-Cookie':makeCookie(nonceName,'',0)};
      if(!saved || saved.state!==url.searchParams.get('state'))return redirect(res,'/?auth=failed',clear);
      if(url.searchParams.get('openid.mode')!=='id_res')return redirect(res,'/?auth=cancelled',clear);
      const returnTo=url.searchParams.get('openid.return_to');
      if(returnTo!==`${BASE_URL}/auth/steam/callback?state=${saved.state}`)return redirect(res,'/?auth=failed',clear);
      const claimed=url.searchParams.get('openid.claimed_id')||'';
      const match=/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/.exec(claimed);
      if(!match || url.searchParams.get('openid.op_endpoint')!=='https://steamcommunity.com/openid/login')return redirect(res,'/?auth=failed',clear);
      const args=new URLSearchParams();
      for(const [k,v] of url.searchParams){if(k.startsWith('openid.'))args.set(k,v)}
      args.set('openid.mode','check_authentication');
      const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),9000);
      let valid=false;
      try{const response=await fetch('https://steamcommunity.com/openid/login',{method:'POST',body:args,headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:controller.signal});const result=await response.text();valid=response.ok&&/\bis_valid:true\b/.test(result)}finally{clearTimeout(timeout)}
      if(!valid)return redirect(res,'/?auth=failed',clear);
      const session=encode({steamid:match[1],exp:Date.now()+7*86400*1000});
      return redirect(res,'/?auth=success',{'Set-Cookie':[makeCookie(nonceName,'',0),makeCookie(cookieName,session,7*86400)]});
    }
    if(req.method==='GET' && url.pathname==='/api/me'){
      const session=decode(c[cookieName]);if(!session)return json(res,200,{authenticated:false});
      const profile=await steamProfile(session.steamid);
      return json(res,200,{authenticated:true,steamid:session.steamid,name:profile.personaname,avatar:profile.avatarfull||null,profileUrl:profile.profileurl||`https://steamcommunity.com/profiles/${session.steamid}/`,profileLimited:!!profile.profileLimited});
    }
    if(req.method==='GET' && url.pathname==='/api/inventory'){
      const session=decode(c[cookieName]);if(!session)return json(res,401,{error:'Faça login na Steam.'});
      try{const data=await fetchJson(`https://steamcommunity.com/inventory/${session.steamid}/730/2?l=english&count=200`);
        if(!data.success)return json(res,409,{error:'A Steam não liberou o inventário. Ele pode estar privado ou temporariamente indisponível.'});
        const descriptions=new Map((data.descriptions||[]).map(d=>[`${d.classid}_${d.instanceid}`,d]));
        const entries=(data.assets||[]).slice(0,200).map(a=>{const d=descriptions.get(`${a.classid}_${a.instanceid}`)||{};return {assetid:String(a.assetid),name:String(d.market_hash_name||d.name||'Item CS2').slice(0,150),image:d.icon_url?`https://community.fastly.steamstatic.com/economy/image/${encodeURIComponent(d.icon_url)}`:null,tradable:d.tradable===1,marketable:d.marketable===1}});
        return json(res,200,{items:entries,more:!!data.more_items,publicOnly:true});
      }catch{return json(res,503,{error:'Não foi possível consultar o inventário público pela Steam. Confira a privacidade e tente mais tarde.'})}
    }
    if(req.method==='POST' && url.pathname==='/auth/logout'){
      if(req.headers.origin!==BASE_URL)return json(res,403,{error:'Origem inválida.'});
      return json(res,200,{ok:true},{'Set-Cookie':makeCookie(cookieName,'',0)});
    }
    if(req.method==='GET' && (url.pathname==='/'||url.pathname==='/index.html')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'});return res.end(index)
    }
    return json(res,404,{error:'Rota não encontrada'});
  }catch(e){console.error('Request failed:',e.message);return json(res,500,{error:'Não foi possível completar a solicitação.'})}
});
server.listen(PORT,()=>console.log(`VANTA disponível em ${BASE_URL}`));
