import { supabase } from './supabase';

export async function syncPreferredLocale(locale:string){
  const {data,error:sessionError}=await supabase.auth.getSession();
  if(sessionError)throw sessionError;
  if(!data.session)return;
  const {error}=await supabase.rpc('update_preferred_locale',{p_locale:locale});
  if(error)throw error;
}
