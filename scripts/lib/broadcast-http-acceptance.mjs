import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

export async function broadcastHttpAcceptance({api,admin,login,sql,check,password,suffix,nodeEnv}) {
  sql(`set request.jwt.claim.role='service_role';
    insert into phase2_finance_policy(policy_key,mode,go_basis_points,go_xl_basis_points,debt_limit_cents,warning_cents,subscription_required,effective_from,authoritative_effective_from)
    values('phase2-driver-finance','AUTHORITATIVE',1500,1500,5000,3000,false,now()-interval '1 day',now()-interval '1 day');
    insert into phase6_policy(singleton,active) values(true,true);
    insert into moovu_admission_state(singleton,mode) values(true,'NORMAL');
    update driver_broadcast_control set enabled=true,effective_from=now()-interval '1 second' where singleton;`);
  const customerEmail=`broadcast-customer-${suffix}@example.invalid`;
  const signup=await api('/api/customer/register',{first_name:'Synthetic',last_name:'Broadcast',email:customerEmail,
    phone:'0646000021',password,acceptedTerms:true,acceptedPrivacy:true,termsVersion:'2026-06-23',privacyVersion:'2026-06-23'});
  check('Broadcast Customer registers through actual API',signup.body?.ok===true);
  const customer=await login(customerEmail);assert.ok(!customer.error);
  const customerToken=customer.data.session.access_token;
  const drivers=[];
  for(let i=0;i<5;i++) {
    const email=`broadcast-driver-${i}-${suffix}@example.invalid`;
    const result=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!result.error);
    const userId=result.data.user.id,driverId=randomUUID();
    sql(`insert into profiles(id,role) values('${userId}','driver');
      insert into drivers(id,first_name,last_name,phone,status,online,verification_status,profile_completed,lat,lng,last_seen,seating_capacity)
      values('${driverId}','Synthetic','Driver','064600003${i}','approved',true,'approved',true,-25.7,28.7,now(),7);
      insert into driver_accounts(user_id,driver_id) values('${userId}','${driverId}');
      insert into phase6_enrollments(driver_id,user_id,existing_driver,completed_at) values('${driverId}','${userId}',false,now());
      insert into fcm_tokens(user_id,role,token,platform,app_type,enabled,device_id)
      values('${userId}','driver','synthetic-${driverId}-device','ios','ios_driver',true,'synthetic-${driverId}');`);
    const signed=await login(email);assert.ok(!signed.error);
    drivers.push({id:driverId,token:signed.data.session.access_token});
  }
  check('Anonymous broadcast worker rejected',(await api('/api/jobs/broadcast',{})).status===401);
  check('Invalid worker credential rejected',(await api('/api/jobs/broadcast',{},'invalid')).status===401);
  check('Customer cannot claim a Driver presence',(await api('/api/driver/presence',{},customerToken)).status===403);
  for(const driver of drivers) check('Authenticated Driver heartbeat succeeds',(await api('/api/driver/presence',{},driver.token)).body?.ok===true);
  const payload=Buffer.from(JSON.stringify({routeSignature:'-25.70000,28.70000|-25.71000,28.71000||driving',distanceKm:2,durationMin:5,
    originalDistanceKm:2,originalDurationMin:5,expiresAt:Date.now()+300000})).toString('base64url');
  const routeQuote=`${payload}.${createHmac('sha256',nodeEnv.MAPS_ROUTE_QUOTE_SECRET).update(payload).digest('base64url')}`;
  const booking=await api('/api/customer/book-trip',{pickupAddress:'Synthetic pickup',dropoffAddress:'Synthetic destination',
    pickupLat:-25.7,pickupLng:28.7,dropoffLat:-25.71,dropoffLng:28.71,distanceKm:2,durationMin:5,
    originalDistanceKm:2,originalDurationMin:5,paymentMethod:'cash',rideType:'now',rideOption:'go',routeQuote},customerToken);
  check(`Real Customer booking succeeds (HTTP ${booking.status}, code ${booking.body?.code??'none'}, error ${booking.body?.error??'none'})`,booking.body?.ok===true);
  const tripId=booking.body.tripId??booking.body.trip?.id??booking.body.id;
  assert.match(tripId,/^[a-f0-9-]{36}$/i);
  check('Customer booking creates one complete five-recipient snapshot',sql(`select count(*) from driver_broadcast_rounds where trip_id='${tripId}' and complete and expected_count=5 and persisted_count=5`)==='1');
  check('Five device notification jobs are persisted',sql(`select count(*) from driver_offer_device_jobs j join driver_trip_offers o on o.id=j.offer_id where o.trip_id='${tripId}'`)==='5');
  const current=await Promise.all(drivers.map(d=>api('/api/driver/offers/current',undefined,d.token)));
  if(current.some(r=>r.body?.offer?.id!==tripId))console.log(JSON.stringify({diagnostic:'synthetic-offer-read',responses:current.map(r=>({status:r.status,code:r.body?.code,error:r.body?.error,info:r.body?.info,hasOffer:!!r.body?.offer})),remainingSeconds:Number(sql(`select extract(epoch from min(accept_deadline_at)-clock_timestamp()) from driver_trip_offers where trip_id='${tripId}'`))}));
  check('Every authenticated Driver retrieves the same live trip',current.every(r=>r.status===200&&r.body?.offer?.id===tripId));
  check('Reconnect retrieves the persisted offer',(await api('/api/driver/offers/current',undefined,drivers[0].token)).body?.offer?.id===tripId);
  const offerId=current[0].body.offer.dispatch_offer_id;
  check('Owned display receipt accepted',(await api('/api/driver/offers/displayed',{offerId},drivers[0].token)).status===200);
  const race=await Promise.all(drivers.map(d=>api('/api/driver/offers/respond',{tripId,action:'accept'},d.token)));
  check('Five authenticated concurrent acceptances produce one winner',race.filter(r=>r.body?.ok===true).length===1);
  check('Four competing offers close',sql(`select count(*) from driver_trip_offers where trip_id='${tripId}' and status='cancelled'`)==='4');
  check('Provider configuration failure never deletes persisted offers',sql(`select count(*) from driver_trip_offers where trip_id='${tripId}'`)==='5');
  check('Authorized durable worker endpoint executes',(await api('/api/jobs/broadcast',{},nodeEnv.DISPATCH_JOB_SECRET)).status===200);
  const denied=await api('/api/driver/offers/current',undefined,customerToken);
  check('Customer cannot see Driver offers',denied.body?.ok===false&&denied.body?.code==='NOT_LINKED'&&!denied.body?.offer);
  const adminEmail=`broadcast-admin-${suffix}@example.invalid`;
  const reviewer=await admin.auth.admin.createUser({email:adminEmail,password,email_confirm:true});assert.ok(!reviewer.error);
  sql(`insert into profiles(id,role) values('${reviewer.data.user.id}','admin');`);
  const signedAdmin=await login(adminEmail);assert.ok(!signedAdmin.error);
  check('Authenticated Admin can inspect the existing dispatch board',(await api('/api/admin/dispatch/board',undefined,signedAdmin.data.session.access_token)).status===200);
  check('Driver cannot read the Admin dispatch board',(await api('/api/admin/dispatch/board',undefined,drivers[0].token)).status===403);
}
