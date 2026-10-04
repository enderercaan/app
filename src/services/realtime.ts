import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

const TYPING_EVENT='typing';
const TYPING_CLOCK_SKEW_MS=15_000;

type TypingPayload={isTyping:unknown;sentAt:unknown};

function readTypingPayload(value:unknown):boolean|null{
  if(!value||typeof value!=='object')return null;
  const payload=value as Partial<TypingPayload>;
  if(typeof payload.isTyping!=='boolean'||typeof payload.sentAt!=='number'||!Number.isFinite(payload.sentAt))return null;
  const age=Date.now()-payload.sentAt;
  if(age < -5_000 || age > TYPING_CLOCK_SKEW_MS)return null;
  return payload.isTyping;
}

export function subscribeToConversation(conversationId: string, onChange: () => void, onTyping?: (isTyping:boolean) => void): RealtimeChannel {
  return supabase.channel(`conversation:${conversationId}`,{config:{private:true,broadcast:{self:false,ack:false}}})
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('broadcast',{event:TYPING_EVENT},({payload})=>{const typing=readTypingPayload(payload);if(typing!==null)onTyping?.(typing)})
    .subscribe();
}

export async function sendConversationTyping(channel:RealtimeChannel,isTyping:boolean){
  try{
    await channel.send({type:'broadcast',event:TYPING_EVENT,payload:{isTyping,sentAt:Date.now()}});
  }catch{
    // Typing is ephemeral UX only. Message delivery remains authoritative and must never depend on it.
  }
}

export function subscribeToUserSignals(userId: string, onInsert: (notificationType?: string) => void): RealtimeChannel {
  return supabase.channel(`user-signals:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
      const type=typeof (payload.new as {type?:unknown}|null)?.type==='string'?String((payload.new as {type:string}).type):undefined;
      onInsert(type);
    })
    .subscribe();
}

export async function unsubscribe(channel?: RealtimeChannel | null) {
  if (channel) await supabase.removeChannel(channel);
}
