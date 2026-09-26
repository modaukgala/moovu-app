"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { supabaseClient } from '@/lib/supabase/client';
import { isCustomerRecoveryEntry } from '@/lib/customer/activeTripRecovery';
import LoadingState from '@/components/ui/LoadingState';

export default function CustomerTripRecovery({children}:{children:React.ReactNode}) {
  const path=usePathname();const router=useRouter();
  const [resolved,setResolved]=useState<string|null>(null);const [error,setError]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const entry=isCustomerRecoveryEntry(path);
  const check=useCallback(async()=>{
    if(!isCustomerRecoveryEntry(path))return;
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    setResolved(null);setError(false);
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
      if(sessionError)throw sessionError;
      if(!session){if(!controller.signal.aborted)setResolved(path);return;}
      const response=await fetch('/api/customer/active-trip',{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal});
      // Non-customer accounts retain their existing mismatch/login experience.
      if(response.status===403){if(!controller.signal.aborted)setResolved(path);return;}
      const body=await response.json();if(!response.ok||!body.ok)throw new Error('Recovery lookup failed');
      if(controller.signal.aborted)return;
      if(body.destination)router.replace(body.destination);else setResolved(path);
    } catch {if(pending.current===controller)setError(true);}
    finally {clearTimeout(timeout);}
  },[path,router]);
  useEffect(()=>{
    if(!entry)return;
    const timer=setTimeout(()=>void check(),0);
    const {data:{subscription}}=supabaseClient.auth.onAuthStateChange((event)=>{
      if(['SIGNED_IN','SIGNED_OUT'].includes(event))setTimeout(()=>void check(),0);
    });
    const visible=()=>{if(!document.hidden)void check();};
    window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    let remove:(()=>void)|undefined;let disposed=false;
    if(Capacitor.isNativePlatform())void App.addListener('appStateChange',state=>{if(state.isActive)void check();}).then(handle=>{if(disposed)void handle.remove();else remove=()=>void handle.remove();}).catch(()=>{});
    return()=>{disposed=true;clearTimeout(timer);subscription.unsubscribe();pending.current?.abort();remove?.();window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[check,entry]);
  if(!entry)return children;
  if(error)return <main className="moovu-page flex min-h-screen items-center justify-center p-6"><div role="alert"><p>We could not check your current ride.</p><button className="moovu-btn" onClick={()=>void check()}>Try again</button></div></main>;
  if(resolved!==path)return <LoadingState title="Restoring your ride" description="Checking your current journey."/>;
  return children;
}
