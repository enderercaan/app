import * as Sentry from '@sentry/react-native';
import { env } from './config';

let initialized=false;
let tracingEnabled=false;
const navigationIntegration=Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay:true,
  routeChangeTimeoutMs:1000,
  ignoreEmptyBackNavigationTransactions:true
});

function scrubEvent(event:any){
  // Tailmance never intentionally attaches account identity, message bodies,
  // request payloads, cookies, auth headers, screenshots, or view hierarchy.
  if(event&&typeof event==='object'){
    delete event.user;
    if(event.request&&typeof event.request==='object'){
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      delete event.request.query_string;
    }
  }
  return event;
}

function scrubBreadcrumb(breadcrumb:any){
  if(!breadcrumb||typeof breadcrumb!=='object')return breadcrumb;
  const category=String(breadcrumb.category??'').toLowerCase();
  if(/(?:http|xhr|fetch|console)/.test(category))return null;
  delete breadcrumb.data;
  if(typeof breadcrumb.message==='string')breadcrumb.message=breadcrumb.message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<id>')
    .slice(0,120);
  return breadcrumb;
}

function scrubTransactionEvent(event:any){
  scrubEvent(event);
  if(event&&typeof event==='object'){
    if(typeof event.transaction==='string')event.transaction=event.transaction.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<id>').slice(0,120);
    if(Array.isArray(event.spans))for(const span of event.spans){
      if(!span||typeof span!=='object')continue;
      if(typeof span.description==='string')span.description=span.description
        .replace(/([?&])[^\s]*/g,'$1<redacted>')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<id>')
        .slice(0,160);
      delete span.data;
      delete span.tags;
    }
  }
  return event;
}

export function initCrashReporting(){
  if(initialized)return;
  initialized=true;
  const production=env.appEnv==='production';
  const configured=production&&/^https:\/\//i.test(env.sentryDsn);
  tracingEnabled=configured;
  Sentry.init({
    dsn: configured?env.sentryDsn:undefined,
    enabled: configured,
    environment: env.appEnv,
    sendDefaultPii: false,
    enableLogs: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableNetworkBreadcrumbs: false,
    enableNetworkEventBreadcrumbs: false,
    maxBreadcrumbs: 20,
    tracesSampleRate: configured?0.05:0,
    enableNativeFramesTracking: configured,
    integrations: configured?[navigationIntegration]:[],
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendTransaction: scrubTransactionEvent
  });
}


const OPERATIONAL_ISSUE_CODE=/^[a-z0-9][a-z0-9_.-]{2,79}$/;

export function registerCrashNavigationContainer(container:any){
  if(!tracingEnabled||!container)return;
  navigationIntegration.registerNavigationContainer(container);
}

export function recordOperationalIssue(code:string){
  const normalized=code.trim().toLowerCase();
  if(!OPERATIONAL_ISSUE_CODE.test(normalized))return;
  Sentry.captureMessage('tailmance_operational_warning',{level:'warning',tags:{operation:normalized}});
}

export function wrapRootWithCrashReporting<T extends React.ComponentType<any>>(component:T):T{
  return Sentry.wrap(component) as T;
}
