"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, X, CreditCard } from 'lucide-react';
import { supabaseClient } from '@/lib/supabase/client';
import type { OnlinePaymentReport, OnlinePaymentReportRow } from '@/lib/payments/onlineReport';
import styles from './report.module.css';

const money = (cents: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents/100);
const date = (value: string) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function day(offset = 0) {
  const now = new Date(Date.now()+7200000+offset*86400000);
  return now.toISOString().slice(0,10);
}

export default function OnlinePaymentsPage() {
  const [payer,setPayer]=useState('all');
  const [range,setRange]=useState('30');
  const [from,setFrom]=useState(day(-29));
  const [to,setTo]=useState(day());
  const [page,setPage]=useState(1);
  const [report,setReport]=useState<OnlinePaymentReport|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<OnlinePaymentReportRow|null>(null);
  const request=useRef<AbortController|null>(null);
  const close=useRef<HTMLButtonElement|null>(null);
  const opener=useRef<HTMLButtonElement|null>(null);
  const load=useCallback(async()=>{
    request.current?.abort();
    const controller=new AbortController(); request.current=controller;
    setLoading(true);setError('');
    try {
      const {data:{session}}=await supabaseClient.auth.getSession();
      if(!session) throw new Error('Please sign in as a financial Admin.');
      const end=new Date(`${to}T00:00:00+02:00`);end.setUTCDate(end.getUTCDate()+1);
      const params=new URLSearchParams({payer,page:String(page),from:`${from}T00:00:00+02:00`,to:end.toISOString()});
      const res=await fetch(`/api/admin/online-payments?${params}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal});
      const json=await res.json();
      if(!res.ok||!json.ok) throw new Error(json.error||"We couldn't load online payments.");
      if(!controller.signal.aborted)setReport(json.report);
    } catch(e) {
      if(!controller.signal.aborted){setReport(null);setError(e instanceof Error?e.message:"We couldn't load online payments.");}
    } finally { if(!controller.signal.aborted)setLoading(false); }
  },[from,to,payer,page]);
  useEffect(()=>{void load();return()=>request.current?.abort();},[load]);
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)void load();};
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[load]);
  useEffect(()=>{
    if(!selected)return;
    close.current?.focus();
    const old=document.body.style.overflow;document.body.style.overflow='hidden';
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape')setSelected(null);
      if(event.key==='Tab'){event.preventDefault();close.current?.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);opener.current?.focus();};
  },[selected]);
  const changeRange=(value:string)=>{
    setRange(value);setPage(1);
    if(value!=='custom'){setFrom(day(1-Number(value)));setTo(day());}
  };
  return <main className={styles.report}>
    <header className={styles.header}><div><h1>Online Payments</h1><p>Verified online payments processed through Yoco.</p></div>
      <button aria-label="Refresh online payments" title="Refresh" disabled={loading} onClick={()=>void load()}><RefreshCw size={20}/></button></header>
    <div className={styles.filters}>
      <div role="group" aria-label="Payer filter">{[['all','All'],['customer','Customers'],['driver','Drivers']].map(([value,label])=><button key={value} aria-pressed={payer===value} onClick={()=>{setPayer(value);setPage(1);}}>{label}</button>)}</div>
      <label>Period<select value={range} onChange={e=>changeRange(e.target.value)}><option value="1">Today</option><option value="7">7 Days</option><option value="30">30 Days</option><option value="custom">Custom</option></select></label>
      {range==='custom'&&<><label>From<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label><label>To<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label></>}
    </div>
    <div className={styles.summary} aria-busy={loading}>
      {[['Total received',report?.total_cents],['Trip payments',report?.trip_cents],['Commission payments',report?.commission_cents]].map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{loading?'--':value===undefined?'--':money(Number(value))}</strong></article>)}
      <article><span>Approved payments</span><strong>{loading?'--':report?.total??'--'}</strong></article>
    </div>
    <p className={styles.note}>Verification time · South Africa (SAST)</p>
    {error?<div role="alert" className={styles.empty}>{error}<button onClick={()=>void load()}>Try again</button></div>:loading?<div aria-label="Loading payments" className={styles.skeleton}/>:!report?.payments.length?<div className={styles.empty}><CreditCard/><p>No approved online payments found.</p></div>:<div className={styles.list}>
      {report.payments.map(row=><button key={row.provider_payment_id} className={styles.payment} onClick={e=>{opener.current=e.currentTarget;setSelected(row);}}>
        <span><small>{date(row.verified_at)}</small><strong>{row.payer}</strong><span>{row.payer_type==='customer'?'Customer · Trip':'Driver · Commission'}</span><small>{row.trip_id?`${row.pickup_address??'Pickup unavailable'} → ${row.dropoff_address??'Destination unavailable'}`:row.purpose}</small></span>
        <span className={styles.amount}><strong>{money(row.amount_cents)}</strong><span className={styles.approved}>Approved</span><small>{row.provider_payment_id}</small></span><ChevronRight size={18}/>
      </button>)}
    </div>}
    {report&&report.total>20&&<div className={styles.pagination}><button aria-label="Previous page" disabled={page===1||loading} onClick={()=>setPage(page-1)}><ChevronLeft/></button><span>Page {page} of {Math.ceil(report.total/20)}</span><button aria-label="Next page" disabled={page*20>=report.total||loading} onClick={()=>setPage(page+1)}><ChevronRight/></button></div>}
    {selected&&<div className={styles.backdrop} onClick={()=>setSelected(null)}><div role="dialog" aria-modal="true" aria-labelledby="payment-title" className={styles.dialog} onClick={e=>e.stopPropagation()}>
      <header className={styles.header}><h2 id="payment-title">Payment details</h2><button ref={close} aria-label="Close payment details" onClick={()=>setSelected(null)}><X/></button></header>
      <strong className={styles.detailAmount}>{money(selected.amount_cents)}</strong><span className={styles.approved}>Approved</span>
      <dl>{Object.entries({Payer:selected.payer,'Payer type':selected.payer_type==='customer'?'Customer':'Driver',Purpose:selected.purpose,'Verified at (SAST)':date(selected.verified_at),Trip:selected.trip_id,Pickup:selected.pickup_address,Destination:selected.dropoff_address,'Yoco payment ID':selected.provider_payment_id,'Yoco checkout ID':selected.provider_checkout_id,'MOOVU payment attempt':selected.id,'Commission settlement ledger':selected.payer_type==='driver'?selected.payment_ledger_transaction_id:null,'Ledger transaction':selected.payment_ledger_transaction_id,'Provider event':selected.provider_event_id}).filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div></div>}
  </main>;
}
