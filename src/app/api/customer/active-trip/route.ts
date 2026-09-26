import { NextResponse } from 'next/server';
import { createServiceSupabase, createUserScopedSupabase, readBearerToken } from '@/lib/customer/server';
import { CUSTOMER_ACTIVE_STATUSES, customerResumeDestination } from '@/lib/customer/activeTripRecovery';

export async function GET(req:Request) {
  const headers={'Cache-Control':'private, no-store'};
  const token=readBearerToken(req);
  if(!token)return NextResponse.json({ok:false},{status:401,headers});
  try {
    const {data:{user},error}=await createUserScopedSupabase(token).auth.getUser();
    if(error||!user)return NextResponse.json({ok:false},{status:401,headers});
    const db=createServiceSupabase();
    const {data:profile,error:profileError}=await db.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if(profileError)throw profileError;
    if(profile?.role&&profile.role!=='customer')return NextResponse.json({ok:false},{status:403,headers});
    // Unlike profile-repair helpers this navigation lookup never creates accounts.
    const {data:customer,error:customerError}=await db.from('customers').select('id,status').eq('auth_user_id',user.id).maybeSingle();
    if(customerError)throw customerError;
    if(!customer||customer.status!=='active')return NextResponse.json({ok:false},{status:403,headers});
    const {data:trips,error:tripError}=await db.from('trips').select('id,status,payment_method,created_at')
      .eq('customer_id',customer.id).in('status',[...CUSTOMER_ACTIVE_STATUSES])
      .or(`ride_type.is.null,ride_type.neq.scheduled,scheduled_for.lte.${new Date().toISOString()},status.in.(assigned,arrived,ongoing)`)
      .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(2);
    if(tripError)throw tripError;
    if(!trips?.length)return NextResponse.json({ok:true,destination:null},{headers});
    if(trips.length>1)console.warn('[customer-resume] multiple active candidates',{countAtLeast:2});
    const trip=trips[0];let paid=false;
    if(trip.payment_method?.toLowerCase()==='online') {
      const {data:attempt,error:paymentError}=await db.from('online_payment_attempts')
        .select('state,verified_at').eq('trip_id',trip.id).eq('customer_id',customer.id)
        .order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(paymentError)throw paymentError;
      paid=attempt?.state==='SUCCEEDED'&&Boolean(attempt.verified_at);
    }
    return NextResponse.json({ok:true,destination:customerResumeDestination(trip,paid)},{headers});
  } catch {
    return NextResponse.json({ok:false,error:'We could not check your current ride. Please try again.'},{status:503,headers});
  }
}
