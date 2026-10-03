import * as Location from 'expo-location';
import { supabase } from './supabase';
import { confirmPrePermission } from './permissionPrompts';

function coarse(value:number){return Math.round(value*1000)/1000;}

export async function updatePrivateLocation(petId: string) {
  let permission=await Location.getForegroundPermissionsAsync();
  if(permission.status!=='granted'){
    const proceed=await confirmPrePermission('location');
    if(!proceed)throw new Error('location_permission_cancelled');
    permission=await Location.requestForegroundPermissionsAsync();
  }
  if (permission.status !== 'granted') throw new Error('location_permission_denied');
  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  // Android reports positions produced by mock-location providers; reject them so spoofed coordinates cannot be
  // used to probe other pets' approximate distance or join a neighbourhood the device is not in.
  if (current.mocked === true) throw new Error('location_mocked');
  // Tailmance only sends ~100 m precision to the backend; exact device coordinates are discarded here.
  const { error } = await supabase.rpc('update_pet_private_location', {
    p_pet_id: petId,
    p_latitude: coarse(current.coords.latitude),
    p_longitude: coarse(current.coords.longitude)
  });
  if (error) throw error;
}
