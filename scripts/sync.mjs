import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const port=8790,base=`http://127.0.0.1:${port}`,id='test-'+Date.now();
const server=spawn('npx',['wrangler','dev','--port',String(port),'--ip','127.0.0.1'],{stdio:['ignore','pipe','pipe'],detached:true});
let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);const sockets=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function client(){const ws=new WebSocket(base.replace('http','ws')+`/f/${id}/ws`),messages=[];sockets.push(ws);ws.on('message',s=>messages.push(JSON.parse(s)));ws.on('error',()=>{});return {ws,messages,async take(type,predicate=()=>true){for(let i=0;i<200;i++){const index=messages.findIndex(m=>m.type===type&&predicate(m));if(index>=0)return messages.splice(index,1)[0];await delay(25);}throw Error('Timed out: '+type+' '+JSON.stringify(messages));},send(m){ws.send(JSON.stringify(m));}};}
try{let ready=false;for(let i=0;i<160;i++){try{const r=await fetch(base+'/f/'+id);if(r.ok){ready=true;break;}}catch{}await delay(100);}assert(ready,'wrangler did not start\n'+log);
 const a=await client(),ai=await a.take('init'),b=await client();await b.take('init');
 const node={id:'rectangle',type:'rect',parent:null,index:'U',name:'Rectangle',x:10,y:20,w:100,h:80,fill:'#ff4f00',stroke:null,strokeWidth:1,radius:0,opacity:1};a.send({type:'ops',seq:1,ops:[{t:'create',node}]});assert.deepEqual((await b.take('ops')).ops[0].node,node);await a.take('ack');console.log('PASS client B receives rectangle creation');
 a.send({type:'ops',seq:2,ops:[{t:'set',id:node.id,key:'x',value:140}]});assert.equal((await b.take('ops')).ops[0].value,140);await a.take('ack');console.log('PASS client B receives live move');
 a.send({type:'presence',cursor:{x:125,y:90},selection:[node.id],name:'Ada',viewport:{x:1,y:2,zoom:1}});const presence=await b.take('presence',m=>m.peer.id===ai.you.id);assert.equal(presence.peer.name,'Ada');assert.deepEqual(presence.peer.cursor,{x:125,y:90});assert.deepEqual(presence.peer.selection,[node.id]);console.log('PASS presence cursor, name and selection relay');
 const c=await client(),ci=await c.take('init');assert.equal(ci.nodes.find(n=>n.id===node.id).x,140);console.log('PASS late client init contains persisted rectangle and move');
 a.ws.close();await b.take('leave',m=>m.id===ai.you.id);console.log('PASS peer departure relay');console.log('Sync integration: 5 checks passed');
}catch(e){console.error(e);console.error(log);process.exitCode=1;}finally{for(const ws of sockets)ws.terminate();try{process.kill(-server.pid,'SIGTERM');}catch{server.kill();}}
