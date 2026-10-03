import { Share } from 'react-native';

type PetSocialSharePayload={petName:string;caption:string;mediaUrl?:string;localizedMessage:string};

// Uses the native share sheet so installed social apps (including Instagram when available)
// can receive the pet media. We never silently upload or post on the user's behalf.
export async function sharePetPost(payload:PetSocialSharePayload){
  const cleanCaption=payload.caption.trim();
  const message=payload.localizedMessage.trim() || `${payload.petName} on Tailmance${cleanCaption?`: ${cleanCaption}`:''}`;
  await Share.share({
    message,
    ...(payload.mediaUrl?{url:payload.mediaUrl}:{}),
    title:`Tailmance • ${payload.petName}`,
  });
}
