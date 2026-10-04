declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

declare module 'https://esm.sh/@supabase/supabase-js@2.111.0' {
  export function createClient(...args: any[]): any;
}

declare module 'npm:livekit-server-sdk@2.19.1' {
  export class AccessToken {
    constructor(apiKey?:string,apiSecret?:string,options?:{identity?:string;name?:string;ttl?:string|number});
    addGrant(grant:{roomJoin?:boolean;room?:string;canPublish?:boolean;canSubscribe?:boolean;canPublishData?:boolean}):void;
    toJwt():Promise<string>;
  }
  export class RoomServiceClient {
    constructor(host:string,apiKey?:string,secret?:string,options?:unknown);
    listRooms(names?:string[]):Promise<Array<{name?:string}>>;
    deleteRoom(room:string):Promise<void>;
  }
}
