import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDirectUserMessageEvent} from '../../src/dsh/session-event.js';

test('normalizes only direct DSH user messages and preserves host event identity/time',()=>{
 const event={type:'user/message',seq:4,time:1793966400000,data:{id:'msg-1',role:'user',source:{kind:'user'},content:[{type:'text',text:'启动元炁'}]}};
 assert.deepEqual(normalizeDirectUserMessageEvent('session-1',event),{verified:true,event_type:'user/message',source_kind:'user',session_id:'session-1',event_id:'msg-1',event_seq:4,event_time:1793966400000,text:'启动元炁'});
 assert.equal(normalizeDirectUserMessageEvent('session-1',{...event,data:{...event.data,source:{kind:'system-prompt'}}}),null);
 assert.equal(normalizeDirectUserMessageEvent('session-1',{...event,type:'assistant/message'}),null);
});

test('non-text and multi-block content never normalize into a startup command',()=>{
 const event={type:'user/message',seq:0,time:1,data:{id:'msg-2',role:'user',source:{kind:'user'},content:[{type:'image'}]}};
 assert.equal(normalizeDirectUserMessageEvent('session-1',event).text,'');
 const multi={...event,data:{...event.data,content:[{type:'text',text:'启动'},{type:'text',text:'元炁'}]}};
 assert.equal(normalizeDirectUserMessageEvent('session-1',multi).text,'');
});
