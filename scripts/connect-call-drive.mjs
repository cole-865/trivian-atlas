// One-time local OAuth bootstrap. Run from the repository with a downloaded,
// mode-600 Google OAuth client JSON. User approves Google's consent screen.
// No production feature flags are enabled by this command.
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat, open } from 'node:fs/promises';
import { resolve } from 'node:path';

const clientPath = process.argv[2];
const redirect = 'http://127.0.0.1:3099/oauth/callback';
const target = resolve('.env.drive.local');
const scope = 'https://www.googleapis.com/auth/drive.file';
let server;
async function jsonRequest(url, init) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('provider_request_failed'); }
  const text = await response.text(); if (text.length > 100000) throw new Error('invalid_response');
  return JSON.parse(text);
}
async function save(values) {
  const lines = Object.entries(values).map(([key, value]) => {
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new Error('invalid_configuration');
    return `${key}=${JSON.stringify(value)}`;
  });
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(lines.join('\n')+'\n'); await handle.sync(); } finally { await handle.close(); }
}
try {
  if (!clientPath || ((await stat(clientPath)).mode & 0o077)) throw new Error('protected_client_file_required');
  try { await stat(target); throw new Error('configuration_already_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const document = JSON.parse(await readFile(clientPath,'utf8'));
  const client = document.web ?? document.installed;
  if (!client?.client_id || !client?.client_secret || (document.web && !client.redirect_uris?.includes(redirect))) throw new Error('client_callback_not_configured');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type:'code', scope, access_type:'offline', prompt:'consent', state,
    code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256' }).toString();
  let consumed=false;
  server=createServer(async(req,res)=>{
    const url=new URL(req.url || '/',redirect);
    if(req.method!=='GET' || req.headers.host!=='127.0.0.1:3099' || url.pathname!=='/oauth/callback') { res.writeHead(404).end(); return; }
    const returned=Buffer.from(url.searchParams.get('state') || ''), expected=Buffer.from(state);
    if(consumed || returned.length!==expected.length || !timingSafeEqual(returned,expected)) { res.writeHead(400).end('Invalid authorization response.'); return; }
    consumed=true;
    try {
      const code=url.searchParams.get('code'); if(!code || url.searchParams.has('error')) throw new Error('authorization_not_granted');
      const token=await jsonRequest('https://oauth2.googleapis.com/token',{ method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}) });
      if(!token.refresh_token || !token.access_token || !String(token.scope || '').split(' ').includes(scope)) throw new Error('offline_access_not_granted');
      const headers={Authorization:`Bearer ${token.access_token}`};
      const about=await jsonRequest('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)',{headers});
      const generated=await jsonRequest('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',{headers});
      const folderId=generated.ids?.[0]; if(!folderId || !about.user?.permissionId) throw new Error('account_verification_failed');
      // Persist credentials and stable folder ID before creation. If creation has
      // an unknown outcome, inspect/recover this same ID instead of reauthorizing.
      await save({ASK865_DRIVE_CLIENT_ID:client.client_id,ASK865_DRIVE_CLIENT_SECRET:client.client_secret,ASK865_DRIVE_REFRESH_TOKEN:token.refresh_token,
        ASK865_DRIVE_OWNER_PERMISSION_ID:about.user.permissionId,ASK865_DRIVE_ARCHIVE_FOLDER_ID:folderId});
      await jsonRequest('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:folderId,name:'Ask 865 Call Recordings',mimeType:'application/vnd.google-apps.folder'})});
      res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('Ask 865 Drive authorization saved. Return to Codex for the private-upload verification.');
      console.log(JSON.stringify({status:'authorized',configurationFile:'.env.drive.local',privateFolderCreated:true,liveProcessingEnabled:false}));
    } catch {
      res.writeHead(500,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('Connection needs verification. Return to Codex. Do not paste keys or authorization codes.');
      console.log(JSON.stringify({status:'connection_needs_verification',liveProcessingEnabled:false})); process.exitCode=1;
    } finally { server.close(); }
  });
  const expiry=setTimeout(()=>{console.log(JSON.stringify({status:'authorization_timed_out'})); server.close();},15*60000);
  server.on('close',()=>clearTimeout(expiry));
  server.on('error',()=>{console.log(JSON.stringify({status:'local_callback_unavailable'}));process.exitCode=1;clearTimeout(expiry);});
  server.listen(3099,'127.0.0.1',()=>console.log(JSON.stringify({status:'awaiting_google_consent',authorizationUrl:authorize.toString()})));
} catch { console.log(JSON.stringify({status:'setup_not_ready',required:'protected OAuth client JSON, matching callback, and no existing .env.drive.local'})); process.exitCode=1; }
