import './style.css'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx-js-style'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// crypto.randomUUID() tidak selalu tersedia pada HTTP alamat IP lokal (mis. 192.168.x.x).
// Gunakan generator UUID yang tetap bekerja di laptop, HP, localhost, dan jaringan Wi-Fi.
function createId(){
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  bytes[6]=(bytes[6]&0x0f)|0x40
  bytes[8]=(bytes[8]&0x3f)|0x80
  const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://nykenupjktgmsotfzrjj.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_iTBUQUsAGiqqKK16KTOmxw_aS7ochfu'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
  realtime: { params:{ eventsPerSecond:5 } }
})
const CLUB_ID = import.meta.env.VITE_CLUB_ID || 'aqilah-swimming-club'
const DATA_TABLE = 'class_app_data'
function trySetLocalStorage(key,value){
  try{localStorage.setItem(key,value);return true}catch(error){console.warn(`localStorage ${key} tidak dapat ditulis karena quota.`,error);return false}
}
const PUSH_DEVICE_ID=localStorage.getItem('asc_push_device_id')||createId()
trySetLocalStorage('asc_push_device_id',PUSH_DEVICE_ID)
async function pushIdentity(){
  let athleteUuid=null,coachUuid=null
  if(role==='parent'&&parentAthleteId){
    const {data,error}=await supabase.from('asc_athletes').select('id').eq('legacy_id',parentAthleteId).maybeSingle()
    if(error)throw error
    athleteUuid=data?.id||null
  }
  if(role==='coach'&&coachId){
    const {data,error}=await supabase.from('asc_coaches').select('id').eq('legacy_id',coachId).maybeSingle()
    if(error)throw error
    coachUuid=data?.id||null
  }
  return {athlete_id:athleteUuid,parent_id:null,coach_id:coachUuid,role:role||'guest'}
}
async function registerPushDeviceToken(fcmToken,platform='web'){
  const token=String(fcmToken||'').trim()
  if(!token)return false
  trySetLocalStorage('asc_fcm_token',token)
  const now=new Date().toISOString()
  try{
    const identity=await pushIdentity()
    const {data,error:readError}=await supabase.from('asc_push_devices').select('device_id').eq('device_id',PUSH_DEVICE_ID).maybeSingle()
    if(readError)throw readError
    const values={...identity,platform:String(platform||'web'),fcm_token:token,inactive:false,last_seen:now,updated_at:now,deleted_at:null}
    const result=data?.device_id
      ?await supabase.from('asc_push_devices').update(values).eq('device_id',PUSH_DEVICE_ID)
      :await supabase.from('asc_push_devices').insert({device_id:PUSH_DEVICE_ID,...values,created_at:now})
    if(result.error)throw result.error
    return true
  }catch(error){console.error('Registrasi token Firebase ke asc_push_devices gagal:',error);return false}
}
async function syncStoredPushDevice(){
  const token=localStorage.getItem('asc_fcm_token')
  if(token)await registerPushDeviceToken(token,globalThis.Capacitor?.isNativePlatform?.()?'android':'web')
}
async function clearCurrentPushDevice(){
  try{
    const now=new Date().toISOString()
    const {error}=await supabase.from('asc_push_devices').update({fcm_token:null,inactive:true,last_seen:now,updated_at:now,deleted_at:now}).eq('device_id',PUSH_DEVICE_ID)
    if(error)throw error
    localStorage.removeItem('asc_fcm_token')
  }catch(error){console.error('Token perangkat gagal dihapus saat logout:',error)}
}
async function sendPushNotification(payload={}){
  try{
    if(payload.inApp!==false&&payload.eventId){
      let recipients=[]
      if(payload.target==='parent')recipients=[{recipientRole:'parent',recipientId:payload.athleteId,athleteId:payload.athleteId,page:payload.deepLinkParent||payload.deepLink||payload.page}]
      else if(payload.target==='coach')recipients=[{recipientRole:'coach',recipientId:payload.coachId,coachId:payload.coachId,page:payload.deepLinkCoach||payload.deepLink||payload.page}]
      else if(payload.target==='all'){
        const categories=Array.isArray(payload.trainingCategories)?payload.trainingCategories:[],groups=Array.isArray(payload.ageGroups)?payload.ageGroups:[]
        const parents=(state.athletes||[]).filter(a=>(!categories.length||categories.includes(a.trainingCategory))&&(!groups.length||groups.some(g=>(a.trainingGroups||[a.ageGroup]).includes(g)))).map(a=>({recipientRole:'parent',recipientId:a.id,athleteId:a.id,page:payload.deepLinkParent||payload.deepLink||payload.page}))
        const coaches=(state.coaches||[]).filter(c=>c.active!==false).map(c=>({recipientRole:'coach',recipientId:c.id,coachId:c.id,page:payload.deepLinkCoach||payload.deepLink||payload.page}))
        recipients=[...parents,...coaches]
      }
      for(const recipient of recipients){
        if(!recipient.recipientId)continue
        const existing=[...(state.notifications||[]),...(state.coachNotifications||[])].some(n=>String(n.referenceId||'')===String(payload.eventId)&&n.type===(payload.type||'push_notification')&&String(n.recipientId||n.coachId||'')===String(recipient.recipientId))
        if(!existing)await upsertTargetedNotification({...recipient,title:payload.title||'AQILAH Swimming Club',message:payload.message||'Ada informasi baru.',type:payload.type||'push_notification',referenceType:payload.referenceType||'push_event',referenceId:payload.eventId})
      }
    }
    const {data,error}=await supabase.functions.invoke('send-push',{body:{clubId:CLUB_ID,...payload,body:payload.body||payload.message,deepLink:payload.deepLink||payload.page||'dashboard',referenceId:payload.referenceId||payload.eventId||''}})
    if(error)throw error
    if(data?.ok===false)throw new Error(data.error||'Firebase menolak pengiriman notifikasi.')
    return data
  }catch(error){console.error('Pengiriman push notification gagal:',error);return null}
}
globalThis.ASCRegisterFcmToken=(token,platform='android')=>registerPushDeviceToken(token,platform)
globalThis.addEventListener?.('aqilah-fcm-token',event=>registerPushDeviceToken(event?.detail?.token,event?.detail?.platform||'android'))
globalThis.ASCOpenDeepLink=deepLink=>{const page=String(deepLink||'').trim();if(!page)return false;currentPage=page;render();return true}
globalThis.addEventListener?.('aqilah-push-open',event=>globalThis.ASCOpenDeepLink(event?.detail?.deepLink||event?.detail?.page))
const ROW_COLLECTIONS = {
  athletes: {
    table: 'asc_athletes',
    toRow: item => ({
      legacy_id:String(item.id||createId()), name:String(item.name||'Tanpa Nama'),
      birth_date:/^\d{4}-\d{2}-\d{2}$/.test(String(item.birth||''))?item.birth:null,
      gender:item.gender||null, category:item.classCategory||item.category||null,
      age_group:item.ageGroup||null, health_notes:item.healthNotes||item.healthNote||null,
      whatsapp:item.parentWhatsapp||item.whatsapp||null, photo_url:item.photo||item.photoUrl||null,
      parent_phone:item.parentPhone||item.parentWhatsapp||null, school_name:item.schoolName||null,
      family_card_url:item.familyCard||null, profile_updated_at:item.profileUpdatedAt||null,
      profile_updated_by:item.profileUpdatedBy||null,
      birth_certificate_url:item.birthCertificate||item.certificate||null,
      registration_proof_url:item.registrationProof||item.paymentProof||null,
      data:item, deleted_at:null, updated_at:new Date().toISOString()
    })
  },
  attendance: {
    table:'asc_attendance',
    toRow:item=>({legacy_id:String(item.id||createId()),attendance_date:/^\d{4}-\d{2}-\d{2}$/.test(String(item.date||''))?item.date:null,status:item.status||null,notes:item.note||item.notes||null,data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  payments: {
    table:'asc_payments',
    toRow:item=>({legacy_id:String(item.id||createId()),payment_type:item.paymentType||item.type||null,amount:Number.isFinite(Number(item.amount))?Number(item.amount):null,payment_date:/^\d{4}-\d{2}-\d{2}$/.test(String(item.date||item.paymentDate||''))?(item.date||item.paymentDate):null,status:item.status||null,proof_url:item.proof||item.proofUrl||item.paymentProof||null,notes:item.note||item.notes||null,data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  trainingPrograms: {
    table:'asc_training_programs',
    toRow:item=>({legacy_id:String(item.id||createId()),title:String(item.title||'Program Latihan'),level:item.level||null,age_groups:Array.isArray(item.trainingGroups)?item.trainingGroups:(Array.isArray(item.ageGroups)?item.ageGroups:null),program_date:/^\d{4}-\d{2}-\d{2}$/.test(String(item.date||''))?item.date:null,image_url:item.image||item.imageUrl||null,content:item.content||item.description||null,data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  timeRecords: {
    table:'asc_time_records',
    toRow:item=>({legacy_id:String(item.id||createId()),stroke:item.stroke||null,distance:Number.isFinite(Number(item.distance))?Number(item.distance):null,record_type:item.type||item.recordType||null,event_level:item.level||item.eventLevel||null,recorded_at:/^\d{4}-\d{2}-\d{2}$/.test(String(item.date||''))?item.date:null,time_value:item.time||item.timeValue||null,notes:item.note||item.notes||null,data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  announcements: {
    table:'asc_announcements',
    toRow:item=>({legacy_id:String(item.id||createId()),title:String(item.title||'Pengumuman'),content:item.body||item.content||null,published_at:/^\d{4}-\d{2}-\d{2}$/.test(String(item.date||''))?`${item.date}T00:00:00.000Z`:new Date().toISOString(),data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  schedules: {
    table:'asc_schedules',
    toRow:item=>({legacy_id:String(item.id||createId()),data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  coaches: {
    table:'asc_coaches',
    toRow:item=>({legacy_id:String(item.id||createId()),data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  pendingRegistrations: {
    table:'asc_registrations',
    toRow:item=>({legacy_id:String(item.id||createId()),data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  notifications: {
    table:'asc_notifications',
    toRow:item=>({legacy_id:String(item.id||createId()),recipient_role:item.recipientRole||'admin',recipient_id:item.recipientId||null,athlete_id:item.athleteId||null,coach_id:item.coachId||null,title:item.title||null,message:item.message||null,type:item.type||null,reference_type:item.referenceType||null,reference_id:item.referenceId||null,deep_link:item.deepLink||item.page||null,created_at:item.createdAt||new Date().toISOString(),read_at:item.readAt||null,data:{...item,notificationAudience:item.notificationAudience||'admin'},deleted_at:null,updated_at:new Date().toISOString()}),
    filterItem:item=>(item.notificationAudience||'admin')!=='coach'
  },
  coachNotifications: {
    table:'asc_notifications',
    toRow:item=>({legacy_id:String(item.id||createId()),recipient_role:'coach',recipient_id:item.recipientId||item.coachId||null,athlete_id:item.athleteId||null,coach_id:item.coachId||item.recipientId||null,title:item.title||null,message:item.message||null,type:item.type||null,reference_type:item.referenceType||null,reference_id:item.referenceId||null,deep_link:item.deepLink||item.page||null,created_at:item.createdAt||new Date().toISOString(),read_at:item.readAt||null,data:{...item,notificationAudience:'coach'},deleted_at:null,updated_at:new Date().toISOString()}),
    filterItem:item=>item.notificationAudience==='coach'
  },
  financeTransactions: {
    table:'asc_finance_transactions',
    select:'legacy_id,transaction_number,transaction_date,created_at,updated_at,created_by,created_role,created_device,data',
    fromRow:row=>({...rowDataToItem(row),transactionNumber:row.transaction_number||row?.data?.transactionNumber||'',transactionDate:row.transaction_date||row?.data?.transactionDate,createdAt:row.created_at||row?.data?.createdAt,updatedAt:row.updated_at||row?.data?.updatedAt,createdBy:row.created_by||row?.data?.createdBy,createdRole:row.created_role||row?.data?.createdRole,createdDevice:row.created_device||row?.data?.createdDevice}),
    toRow:item=>({legacy_id:String(item.id||createId()),transaction_number:item.transactionNumber||null,transaction_date:item.transactionDate||new Date().toISOString(),transaction_type:item.transactionType||null,category:item.category||null,direction:item.direction==='expense'?'expense':'income',amount:Number(item.amount||0),description:item.description||null,athlete_id:item.athleteId||null,athlete_name:item.athleteName||null,coach_id:item.coachId||null,coach_name:item.coachName||null,payment_id:item.paymentId||null,competition_id:item.competitionId||null,reference_type:item.referenceType||null,reference_id:item.referenceId||null,proof_url:item.proofUrl||null,created_by:item.createdBy||currentActor(),created_role:item.createdRole||role||'system',created_device:item.createdDevice||PUSH_DEVICE_ID,data:item,deleted_at:null,updated_at:new Date().toISOString()})
  },
  invoices: {
    table:'asc_invoices',
    toRow:item=>({legacy_id:String(item.id||createId()),athlete_id:item.athleteId||null,athlete_name:item.athleteName||null,invoice_type:item.type||null,title:item.title||null,amount:Number(item.amount||0),due_date:/^\d{4}-\d{2}-\d{2}$/.test(String(item.dueDate||''))?item.dueDate:null,status:item.status||'unpaid',description:item.description||null,data:item,deleted_at:null,updated_at:new Date().toISOString()}),
    trueEmptyFallback:true
  },
  competitions: {
    table:'asc_competitions',
    toRow:item=>({legacy_id:String(item.id||createId()),title:item.title||null,event_date:/^\d{4}-\d{2}-\d{2}$/.test(String(item.eventDate||''))?item.eventDate:null,location:item.location||null,registration_deadline:/^\d{4}-\d{2}-\d{2}$/.test(String(item.registrationDeadline||''))?item.registrationDeadline:null,organizer:item.organizer||null,fee_per_race:Number(item.feePerRace||0),flyer_url:item.flyer||null,description:item.description||null,data:item,deleted_at:null,updated_at:new Date().toISOString()}),
    trueEmptyFallback:true
  }
}
const ROW_COLLECTION_KEYS=Object.keys(ROW_COLLECTIONS)
const DEDICATED_COLLECTION_KEYS=new Set(ROW_COLLECTION_KEYS)
const BULK_ROW_COLLECTION_KEYS=ROW_COLLECTION_KEYS.filter(key=>!DEDICATED_COLLECTION_KEYS.has(key))
const recentLocalRowWrites=new Map()
function stableSerialize(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value)
  if(Array.isArray(value))return `[${value.map(stableSerialize).join(',')}]`
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
}
function dedicatedCollectionsFingerprint(source=state){
  const snapshot={}
  ROW_COLLECTION_KEYS.forEach(key=>{
    const rows=Array.isArray(source?.[key])?source[key]:[]
    snapshot[key]=rows.slice().sort((a,b)=>String(a?.id||'').localeCompare(String(b?.id||'')))
  })
  return stableSerialize(snapshot)
}
function markLocalRowWrite(table,id){
  if(!table||id===undefined||id===null)return
  recentLocalRowWrites.set(`${table}:${String(id)}`,Date.now()+5000)
}
function isRecentLocalRowEvent(table,payload){
  const now=Date.now()
  recentLocalRowWrites.forEach((expires,key)=>{if(expires<=now)recentLocalRowWrites.delete(key)})
  const id=payload?.new?.legacy_id||payload?.old?.legacy_id
  return id!==undefined&&id!==null&&Number(recentLocalRowWrites.get(`${table}:${String(id)}`)||0)>now
}
function rowDataToItem(row){
  const item=row?.data&&typeof row.data==='object'?structuredClone(row.data):{}
  item.id=item.id||row?.legacy_id
  return item
}
async function loadRowCollections(){
  const before=dedicatedCollectionsFingerprint()
  let legacyPayload={}
  let legacyRowExists=false
  try{
    const {data,error}=await supabase.from(DATA_TABLE).select('payload').eq('class_id',CLUB_ID).maybeSingle()
    if(error)throw error
    legacyRowExists=Boolean(data)
    legacyPayload=data?.payload&&typeof data.payload==='object'?data.payload:{}
  }catch(error){
    console.error('Supabase class_app_data gagal dibaca untuk fallback Data Atlet:',error)
  }
  const results=await Promise.all(ROW_COLLECTION_KEYS.map(async key=>{
    const cfg=ROW_COLLECTIONS[key]
    try{
      const {data,error}=await supabase.from(cfg.table).select(cfg.select||'legacy_id,data,updated_at').is('deleted_at',null)
      if(error)throw error
      const items=(data||[]).map(row=>typeof cfg.fromRow==='function'?cfg.fromRow(row):rowDataToItem(row)).sort((a,b)=>String(a?.id||'').localeCompare(String(b?.id||'')))
      let totalCount=null
      if(cfg.trueEmptyFallback){
        const {count,error:countError}=await supabase.from(cfg.table).select('legacy_id',{count:'exact',head:true})
        if(countError)throw countError
        totalCount=Number(count||0)
      }
      return [key,typeof cfg.filterItem==='function'?items.filter(cfg.filterItem):items,null,totalCount]
    }catch(error){
      console.error(`Supabase ${cfg.table} gagal dibaca:`,error)
      return [key,[],error,null]
    }
  }))
  results.forEach(([key,items,error,totalCount])=>{
    const fallback=key==='financeTransactions'?[]:(Array.isArray(legacyPayload[key])?legacyPayload[key]:[])
    if(key==='athletes'){
      if(!error&&items.length)state.athletes=items
      else if(fallback.length)state.athletes=structuredClone(fallback)
      else if(legacyRowExists&&isBundledDefaultAthleteList(state.athletes))state.athletes=[]
      // Bila kedua sumber kosong/gagal, pertahankan data perangkat. Jangan pernah
      // mengganti data atlet yang masih ada dengan array kosong.
      return
    }
    if(['invoices','competitions'].includes(key)){
      const tombstones=state.__tombstones?.[key]||{}
      const safeFallback=[...new Map(fallback.filter(item=>!tombstones[String(item?.id||'')]).map(item=>[String(item?.id||''),item])).values()].filter(item=>item?.id)
      if(!error&&items.length)state[key]=items
      else if(!error&&Number(totalCount)>0)state[key]=[]
      else if(safeFallback.length)state[key]=structuredClone(safeFallback)
      return
    }
    if(!error&&items.length)state[key]=items
    else if(fallback.length)state[key]=structuredClone(fallback)
    // Bila tabel dan fallback kosong, cache perangkat tidak pernah diganti [].
  })
  normalize()
  const changed=before!==dedicatedCollectionsFingerprint()
  if(changed)saveLocal()
  return changed
}
function isBundledDefaultAthleteList(items){
  const defaults=defaultState?.athletes||[]
  return Array.isArray(items)&&items.length===defaults.length&&items.every((item,index)=>item?.id===defaults[index]?.id&&item?.name===defaults[index]?.name)
}
function applyRemotePayloadPreservingDedicated(payload){
  const previous=state
  const next={...structuredClone(defaultState),...(payload&&typeof payload==='object'?payload:{})}
  DEDICATED_COLLECTION_KEYS.forEach(key=>{
    if((!Array.isArray(next[key])||next[key].length===0)&&Array.isArray(previous?.[key])&&previous[key].length){
      next[key]=structuredClone(previous[key])
    }
  })
  if(stableSerialize(next)===stableSerialize(previous))return false
  state=next
  return true
}
async function saveRowCollections(snapshot){
  for(const key of BULK_ROW_COLLECTION_KEYS){
    const cfg=ROW_COLLECTIONS[key]
    const rows=(Array.isArray(snapshot?.[key])?snapshot[key]:[]).map(cfg.toRow)
    for(let i=0;i<rows.length;i+=200){
      const chunk=rows.slice(i,i+200)
      if(!chunk.length)continue
      const {error}=await supabase.from(cfg.table).upsert(chunk,{onConflict:'legacy_id'})
      if(error)throw new Error(`${cfg.table}: ${error.message||error}`)
    }
    const tombstones=Object.keys(snapshot?.__tombstones?.[key]||{})
    for(let i=0;i<tombstones.length;i+=100){
      const ids=tombstones.slice(i,i+100)
      if(!ids.length)continue
      const {error}=await supabase.from(cfg.table).update({deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).in('legacy_id',ids)
      if(error)throw new Error(`${cfg.table}: ${error.message||error}`)
    }
  }
}
async function upsertAthleteRecord(item){
  const cfg=ROW_COLLECTIONS.athletes
  markLocalRowWrite(cfg.table,item?.id)
  const {error}=await supabase.from(cfg.table).upsert(cfg.toRow(item),{onConflict:'legacy_id'})
  if(error){
    console.error('Supabase asc_athletes gagal menyimpan record:',error)
    throw new Error(`asc_athletes: ${error.message||error}`)
  }
}
async function softDeleteAthleteRecord(id){
  const deletedAt=new Date().toISOString()
  markLocalRowWrite(ROW_COLLECTIONS.athletes.table,id)
  const {error}=await supabase.from(ROW_COLLECTIONS.athletes.table)
    .update({deleted_at:deletedAt,updated_at:deletedAt}).eq('legacy_id',String(id))
  if(error){
    console.error('Supabase asc_athletes gagal menandai satu record terhapus:',error)
    throw new Error(`asc_athletes: ${error.message||error}`)
  }
}
async function upsertAttendanceRecord(item){
  const cfg=ROW_COLLECTIONS.attendance
  markLocalRowWrite(cfg.table,item?.id)
  const {error}=await supabase.from(cfg.table).upsert(cfg.toRow(item),{onConflict:'legacy_id'})
  if(error){
    console.error('Supabase asc_attendance gagal menyimpan satu record:',error)
    throw new Error(`asc_attendance: ${error.message||error}`)
  }
}
async function softDeleteAttendanceRecord(id){
  const deletedAt=new Date().toISOString()
  markLocalRowWrite(ROW_COLLECTIONS.attendance.table,id)
  const {error}=await supabase.from(ROW_COLLECTIONS.attendance.table)
    .update({deleted_at:deletedAt,updated_at:deletedAt}).eq('legacy_id',String(id))
  if(error){
    console.error('Supabase asc_attendance gagal menandai satu record terhapus:',error)
    throw new Error(`asc_attendance: ${error.message||error}`)
  }
}
async function upsertDedicatedRecord(collection,item){
  const cfg=ROW_COLLECTIONS[collection]
  if(!cfg)throw new Error(`Konfigurasi tabel ${collection} tidak ditemukan.`)
  markLocalRowWrite(cfg.table,item?.id)
  const {error}=await supabase.from(cfg.table).upsert(cfg.toRow(item),{onConflict:'legacy_id'})
  if(error){
    console.error(`Supabase ${cfg.table} gagal menyimpan satu record:`,error)
    throw new Error(`${cfg.table}: ${error.message||error}`)
  }
}
async function upsertFinanceRecord(item){
  const cfg=ROW_COLLECTIONS.financeTransactions
  markLocalRowWrite(cfg.table,item?.id)
  const {data,error}=await supabase.from(cfg.table).upsert(cfg.toRow(item),{onConflict:'legacy_id'}).select(cfg.select).single()
  if(error){console.error('Supabase asc_finance_transactions gagal menyimpan transaksi:',error);throw new Error(`asc_finance_transactions: ${error.message||error}`)}
  Object.assign(item,cfg.fromRow(data))
  saveLocal()
  return item
}
async function softDeleteDedicatedRecord(collection,id){
  const cfg=ROW_COLLECTIONS[collection]
  if(!cfg)throw new Error(`Konfigurasi tabel ${collection} tidak ditemukan.`)
  const deletedAt=new Date().toISOString()
  markLocalRowWrite(cfg.table,id)
  const {error}=await supabase.from(cfg.table).update({deleted_at:deletedAt,updated_at:deletedAt}).eq('legacy_id',String(id))
  if(error){
    console.error(`Supabase ${cfg.table} gagal menandai satu record terhapus:`,error)
    throw new Error(`${cfg.table}: ${error.message||error}`)
  }
}
const CLIENT_ID = localStorage.getItem('asc_client_id') || createId()
trySetLocalStorage('asc_client_id', CLIENT_ID)
const AGE_REFERENCE_DATE = new Date('2026-01-01T00:00:00')

const defaultState = {
  settings: { clubName:'AQILAH Swimming Club', coachName:'Fahmi Djawas, S.Pd.', logo:'', adminUsername:'admin', adminPassword:'123456' },
  athletes: [{"id":"ASC-0001","name":"Arsya Muhammad Zidni","photo":"","birth":"2014-04-03","age":11,"ageGroup":"KU 3"},{"id":"ASC-0002","name":"Muhammad Everest Kenzo Sulaeman","photo":"","birth":"2014-02-06","age":11,"ageGroup":"KU 3"},{"id":"ASC-0003","name":"Bima Arka Sanjaya Putra","photo":"","birth":"2010-03-15","age":15,"ageGroup":"KU 1"},{"id":"ASC-0004","name":"Fathiya Kamila Ramadhina","photo":"","birth":"2014-07-18","age":11,"ageGroup":"KU 3"},{"id":"ASC-0005","name":"Khansa Sabiha Alzena Thafana","photo":"","birth":"2014-09-17","age":11,"ageGroup":"KU 3"},{"id":"ASC-0006","name":"Ceisya Kasmira Zalfa","photo":"","birth":"2014-11-07","age":11,"ageGroup":"KU 3"},{"id":"ASC-0007","name":"Rivallen Athaya Indrata","photo":"","birth":"2014-03-27","age":11,"ageGroup":"KU 3"},{"id":"ASC-0008","name":"Laode Ibra Almuharizi","photo":"","birth":"2013-12-01","age":12,"ageGroup":"KU 3"},{"id":"ASC-0009","name":"Qaleishaundreey Namia Mumtazshah","photo":"","birth":"2013-09-08","age":12,"ageGroup":"KU 3"},{"id":"ASC-0010","name":"Kane Aprillio Bramasta","photo":"","birth":"2017-04-22","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0011","name":"Lorenzo Halim","photo":"","birth":"2015-02-25","age":10,"ageGroup":"KU 4"},{"id":"ASC-0012","name":"Kanza Azzahra Sasikirana","photo":"","birth":"2014-04-01","age":11,"ageGroup":"KU 3"},{"id":"ASC-0013","name":"Rasyhavin Althaf Indrata","photo":"","birth":"2009-08-23","age":16,"ageGroup":"KU 1"},{"id":"ASC-0014","name":"Barra Azka Sanjaya Putra","photo":"","birth":"2012-01-15","age":13,"ageGroup":"KU 2"},{"id":"ASC-0015","name":"Ferdiansyah Ivanov Hasibuan","photo":"","birth":"2012-11-11","age":13,"ageGroup":"KU 2"},{"id":"ASC-0016","name":"Vio Amarrio Ilham","photo":"","birth":"2016-05-06","age":9,"ageGroup":"KU 4"},{"id":"ASC-0017","name":"Abiyan Shaka Purnomo","photo":"","birth":"2014-02-15","age":11,"ageGroup":"KU 3"},{"id":"ASC-0018","name":"Anandya Rizki Almahyra (Arra)","photo":"","birth":"2016-10-26","age":9,"ageGroup":"KU 4"},{"id":"ASC-0019","name":"Muhammad Rayyan Hamizan Rahmansyah","photo":"","birth":"2016-11-16","age":9,"ageGroup":"KU 4"},{"id":"ASC-0020","name":"Calista Zahra Aqila Putri","photo":"","birth":"2014-05-28","age":11,"ageGroup":"KU 3"},{"id":"ASC-0021","name":"Adzkia Ramadhani Susilo","photo":"","birth":"2014-07-17","age":11,"ageGroup":"KU 3"},{"id":"ASC-0022","name":"Benno P Lelono","photo":"","birth":"2002-04-14","age":23,"ageGroup":"KU 1"},{"id":"ASC-0023","name":"Reza Rasya Athaya","photo":"","birth":"2013-10-19","age":12,"ageGroup":"KU 3"},{"id":"ASC-0024","name":"Ataya K.N","photo":"","birth":"2014-02-01","age":11,"ageGroup":"KU 3"},{"id":"ASC-0025","name":"Calysta Kinara Anabella","photo":"","birth":"2013-09-06","age":12,"ageGroup":"KU 3"},{"id":"ASC-0026","name":"Haritz Yusuf Umaryaji","photo":"","birth":"2013-07-26","age":12,"ageGroup":"KU 3"},{"id":"ASC-0027","name":"Faqih Hayatullah","photo":"","birth":"2010-02-16","age":15,"ageGroup":"KU 1"},{"id":"ASC-0028","name":"Joanne Halim","photo":"","birth":"2012-06-19","age":13,"ageGroup":"KU 2"},{"id":"ASC-0029","name":"Syahla Roihanah","photo":"","birth":"2013-12-05","age":12,"ageGroup":"KU 3"},{"id":"ASC-0030","name":"Orlin Mukhbita Yusfi","photo":"","birth":"2017-07-21","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0031","name":"Dzaka Ahnaf Setiawan","photo":"","birth":"2014-07-13","age":11,"ageGroup":"KU 3"},{"id":"ASC-0032","name":"Rizky Ananda Putra Pratama","photo":"","birth":"2010-12-30","age":15,"ageGroup":"KU 1"},{"id":"ASC-0033","name":"Mohammad Alvaro Alcantara Ikhmawan","photo":"","birth":"2017-04-12","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0034","name":"Alisha Fakhira Hakim","photo":"","birth":"2015-07-04","age":10,"ageGroup":"KU 4"},{"id":"ASC-0035","name":"M. Luthfi Alviyan (Alvin)","photo":"","birth":"2013-05-02","age":12,"ageGroup":"KU 3"},{"id":"ASC-0036","name":"Bastian Ben Cipta","photo":"","birth":"2015-01-15","age":10,"ageGroup":"KU 4"},{"id":"ASC-0037","name":"Maulana Akbar Pratama","photo":"","birth":"2014-06-24","age":11,"ageGroup":"KU 3"},{"id":"ASC-0038","name":"Rizky Hideo Januardi","photo":"","birth":"2014-01-22","age":11,"ageGroup":"KU 3"},{"id":"ASC-0039","name":"Salma Azzahra Nugroho","photo":"","birth":"2013-06-11","age":12,"ageGroup":"KU 3"},{"id":"ASC-0040","name":"El Emira Shanum Haryanto","photo":"","birth":"2015-11-18","age":10,"ageGroup":"KU 4"},{"id":"ASC-0041","name":"Alula Farzana Prameswari","photo":"","birth":"2015-09-16","age":10,"ageGroup":"KU 4"},{"id":"ASC-0042","name":"Arfan Rafisqi Alfarizi","photo":"","birth":"2017-09-12","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0043","name":"Muhammad Kenzo Alkhalifi","photo":"","birth":"2017-07-08","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0044","name":"Najmah Safiyya Bakri","photo":"","birth":"2013-10-28","age":12,"ageGroup":"KU 3"},{"id":"ASC-0045","name":"Nayazka Athariz Bakri","photo":"","birth":"2018-08-21","age":7,"ageGroup":"KU 5B"},{"id":"ASC-0046","name":"Namira Arimbi J","photo":"","birth":"2015-03-16","age":10,"ageGroup":"KU 4"},{"id":"ASC-0047","name":"M Arfa Prahasta","photo":"","birth":"2017-04-12","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0048","name":"Callista Keumala Sally","photo":"","birth":"2012-03-15","age":13,"ageGroup":"KU 2"},{"id":"ASC-0049","name":"Fairuz Anargya Efrayim","photo":"","birth":"2014-03-31","age":11,"ageGroup":"KU 3"},{"id":"ASC-0050","name":"Shakila Dhira Kaneesha","photo":"","birth":"2012-06-11","age":13,"ageGroup":"KU 2"},{"id":"ASC-0051","name":"Satria Adyarizki Nugroho","photo":"","birth":"2018-03-13","age":7,"ageGroup":"KU 5B"},{"id":"ASC-0052","name":"Galih Basir Pratama","photo":"","birth":"2015-04-17","age":10,"ageGroup":"KU 4"},{"id":"ASC-0053","name":"M Fauzan Alghifari","photo":"","birth":"2016-04-04","age":9,"ageGroup":"KU 4"},{"id":"ASC-0054","name":"Khalid Khairan Nafiz","photo":"","birth":"2017-12-26","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0055","name":"Rasyid Putra Martono","photo":"","birth":"2013-12-16","age":12,"ageGroup":"KU 3"},{"id":"ASC-0056","name":"Aaron","photo":"","birth":"2013-01-23","age":12,"ageGroup":"KU 3"},{"id":"ASC-0057","name":"Gio Evander","photo":"","birth":"2014-11-01","age":11,"ageGroup":"KU 3"},{"id":"ASC-0058","name":"Joanna","photo":"","birth":"2017-03-08","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0059","name":"Lisana Shidqin Aliyyah Putri","photo":"","birth":"2014-05-21","age":11,"ageGroup":"KU 3"},{"id":"ASC-0060","name":"Rafasya Atha Ramadian","photo":"","birth":"2017-05-29","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0061","name":"Shazia","photo":"","birth":"2012-12-26","age":13,"ageGroup":"KU 2"},{"id":"ASC-0062","name":"Arzachel Fachry Maulana","photo":"","birth":"2014-04-26","age":11,"ageGroup":"KU 3"},{"id":"ASC-0063","name":"Fazian Rafqi Nurkhoir","photo":"","birth":"2016-06-15","age":9,"ageGroup":"KU 4"},{"id":"ASC-0064","name":"Ryuga Arsakha Firdausiy","photo":"","birth":"2019-07-07","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0065","name":"Lingga Quds Dastan Ar Rafif","photo":"","birth":"2016-01-22","age":9,"ageGroup":"KU 4"},{"id":"ASC-0066","name":"Nayla Qiandra Almahyra","photo":"","birth":"2019-04-04","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0067","name":"Ahmad Adzki Averroes","photo":"","birth":"2017-08-27","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0068","name":"Tiffany Noura","photo":"","birth":"2015-08-26","age":10,"ageGroup":"KU 4"},{"id":"ASC-0069","name":"Agha Bahran Arsyanendra","photo":"","birth":"2018-12-30","age":7,"ageGroup":"KU 5B"},{"id":"ASC-0070","name":"Danesha Aquina Athaya","photo":"","birth":"2014-03-17","age":11,"ageGroup":"KU 3"},{"id":"ASC-0071","name":"Haqqi Ahmad Al Atiq","photo":"","birth":"2016-11-03","age":9,"ageGroup":"KU 4"},{"id":"ASC-0072","name":"Marsa Liaska Ottay","photo":"","birth":"2018-02-15","age":7,"ageGroup":"KU 5B"},{"id":"ASC-0073","name":"Bhadrika Ali Wibisana","photo":"","birth":"2016-03-01","age":9,"ageGroup":"KU 4"},{"id":"ASC-0074","name":"Arsenio Zhafran Afersha","photo":"","birth":"2016-05-20","age":9,"ageGroup":"KU 4"},{"id":"ASC-0075","name":"Selma Kinara Mikayla","photo":"","birth":"2017-12-15","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0076","name":"Dhafin Alvaro Harianto","photo":"","birth":"2013-06-28","age":12,"ageGroup":"KU 3"},{"id":"ASC-0077","name":"Devy Damayanti","photo":"","birth":"2012-10-20","age":13,"ageGroup":"KU 2"},{"id":"ASC-0078","name":"Nasyitha Zafira A.","photo":"","birth":"2010-11-14","age":15,"ageGroup":"KU 1"},{"id":"ASC-0079","name":"Azalea Khaylila Gayatri","photo":"","birth":"2019-02-25","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0080","name":"Rayyanza Mannaf Afersha (Anza)","photo":"","birth":"2019-07-16","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0081","name":"Marcello Akbar Rais Santoso","photo":"","birth":"2019-09-07","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0082","name":"Zherina Sesya Eltantra","photo":"","birth":"2019-10-06","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0083","name":"Zherina Sesya El Tantra","photo":"","birth":"2019-10-02","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0084","name":"Rania Ufaira Putri","photo":"","birth":"2016-12-27","age":9,"ageGroup":"KU 4"},{"id":"ASC-0085","name":"M Kin","photo":"","birth":"2017-09-07","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0086","name":"Abryssam Uwais Albaraka","photo":"","birth":"2016-02-17","age":9,"ageGroup":"KU 4"},{"id":"ASC-0087","name":"Sabith Muhammad Albaraka","photo":"","birth":"2019-11-19","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0088","name":"Kemal Ghifari Susanto","photo":"","birth":"2017-04-01","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0089","name":"Salman Al Farisi","photo":"","birth":"2020-04-16","age":5,"ageGroup":"KU 5A"},{"id":"ASC-0090","name":"Iman Baihaqi","photo":"","birth":"2018-10-09","age":7,"ageGroup":"KU 5B"},{"id":"ASC-0091","name":"Mysha Shaqueena Humairah","photo":"","birth":"2017-02-14","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0092","name":"Muhamad Albifardzan Rizki","photo":"","birth":"2017-12-27","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0093","name":"Muhamad Akhdan Rizki","photo":"","birth":"2019-12-16","age":6,"ageGroup":"KU 5A"},{"id":"ASC-0094","name":"Arka Ghaisan Wahyudi","photo":"","birth":"2017-07-07","age":8,"ageGroup":"KU 5B"},{"id":"ASC-0095","name":"Zahian Adirajada Budiansyah","photo":"","birth":"2018-11-08","age":7,"ageGroup":"KU 5B"},{"id":"ASC-0096","name":"Acharya Adhiwidyo","photo":"","birth":"2012-03-19","age":13,"ageGroup":"KU 2"},{"id":"ASC-0097","name":"Arsyalfi Zhafif Azzam Hartono","photo":"","birth":"2014-05-09","age":11,"ageGroup":"KU 3"}],
  attendance: [],
  schedules: [{id:createId(),day:'Jumat',time:'16:00',location:'Kolam Renang Utama',group:'Prestasi'}],
  payments: [],
  competitions: [],
  announcements: [{id:createId(),title:'Selamat datang',body:'Aplikasi AQILAH Swimming Club siap digunakan.',date:new Date().toISOString().slice(0,10)}],
  timeRecords: [],
  trainingPrograms: [],
  coaches: [
    { id:'PLT-0001', name:'Pelatih Utama', username:'pelatih', password:'123456', active:true, mustChangePassword:true }
  ],
  pendingRegistrations: [],
  weeklyTargets: [],
  skillJournals: [],
  drylandTasks: [],
  rescheduleRequests: [],
  athletePackages: [],
  parentReminders: {},
  invoices: [],
  coachSalaries: [],
  coachNotifications: [],
  notifications: [],
  financeTransactions: []
}

let state = structuredClone(defaultState)

// Sesi login disimpan di localStorage agar tidak hilang ketika Android
// membuat ulang WebView saat orientasi layar berubah. Tidak ada password
// yang disimpan; hanya peran, ID akun aktif, dan halaman terakhir.
const readSessionValue=(key)=>sessionStorage.getItem(key)||localStorage.getItem(key)||''
let currentPage = readSessionValue('asc_current_page') || 'dashboard'
let role = readSessionValue('asc_role') || ''
let parentAthleteId = readSessionValue('asc_parent_athlete') || ''
let coachId = readSessionValue('asc_coach_id') || ''
function persistActiveSession(){
  const values={asc_role:role,asc_parent_athlete:parentAthleteId,asc_coach_id:coachId,asc_current_page:currentPage}
  Object.entries(values).forEach(([key,value])=>{
    if(value){sessionStorage.setItem(key,value);trySetLocalStorage(key,value)}
    else {sessionStorage.removeItem(key);localStorage.removeItem(key)}
  })
}
function clearActiveSession(){
  ['asc_role','asc_parent_athlete','asc_coach_id','asc_current_page'].forEach(key=>{
    sessionStorage.removeItem(key);localStorage.removeItem(key)
  })
}
let syncStatus = 'Data siap digunakan'
let pendingRemoteSave = false
let retryTimer = null
let unsubscribeRealtime = null
let deferredRemoteRender = false
let remoteRenderTimer = null
let pendingRemoteScroll = null
let realtimeActive = false

// Jangan membangun ulang seluruh halaman ketika pengguna sedang mengisi form.
// Render ulang dari sinkronisasi Supabase sebelumnya membuat dialog tertutup dan
// isi form hilang secara tiba-tiba pada Catatan Waktu, Perkembangan Atlet,
// Data Pelatih, dan Data Atlet.
function isUserEditingForm(){
  if(document.querySelector('dialog[open]')) return true
  const active=document.activeElement
  return Boolean(active && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName) && active.closest('form'))
}
function renderRemoteUpdateSafely(scroll={x:window.scrollX,y:window.scrollY}){
  if(isUserEditingForm()){
    deferredRemoteRender=true
    updateSync()
    return false
  }
  deferredRemoteRender=false
  pendingRemoteScroll=scroll
  clearTimeout(remoteRenderTimer)
  remoteRenderTimer=setTimeout(()=>{
    remoteRenderTimer=null
    if(isUserEditingForm()){
      deferredRemoteRender=true
      updateSync()
      return
    }
    const restore=pendingRemoteScroll
    pendingRemoteScroll=null
    render()
    if(restore)requestAnimationFrame(()=>window.scrollTo(restore.x,restore.y))
  },220)
  return true
}
function finishDeferredRemoteRender(){
  if(!deferredRemoteRender || isUserEditingForm()) return
  renderRemoteUpdateSafely()
}
const app = document.querySelector('#app')

const strokes = ['Gaya Bebas','Gaya Bebas Fins','Gaya Punggung','Gaya Punggung Fins','Gaya Kupu-kupu','Gaya Kupu-kupu Fins','Gaya Dada']

function esc(v='') { return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) }
function calcAge(birth) {
  const d=new Date(`${birth}T00:00:00`); if(Number.isNaN(d.getTime())) return ''
  let a=AGE_REFERENCE_DATE.getFullYear()-d.getFullYear()
  if(AGE_REFERENCE_DATE.getMonth()<d.getMonth()||(AGE_REFERENCE_DATE.getMonth()===d.getMonth()&&AGE_REFERENCE_DATE.getDate()<d.getDate())) a--
  return Math.max(0,a)
}
function calcGroup(birth) {
  const y=Number(String(birth).slice(0,4)); if(!y)return ''
  if(y<=2010)return 'KU 1'; if(y<=2012)return 'KU 2'; if(y<=2014)return 'KU 3'; if(y<=2016)return 'KU 4'; if(y<=2018)return 'KU 5B'; return 'KU 5A'
}
function nextAthleteId() {
  // Gunakan kembali nomor terkecil yang sedang kosong. Contoh: bila ASC-0012
  // sudah dihapus, pendaftar berikutnya akan memperoleh ASC-0012.
  const used=new Set((state.athletes||[]).map(a=>Number(String(a.id||'').replace(/\D/g,''))).filter(Number.isFinite))
  let number=1
  while(used.has(number)) number++
  return `ASC-${String(number).padStart(4,'0')}`
}
function normalize() {
  state.athletes=(state.athletes||[]).map((a,i)=>({
    ...a,
    id:a.id||`ASC-${String(i+1).padStart(4,'0')}`,
    photo:a.photo||'',
    age:calcAge(a.birth),
    ageGroup:calcGroup(a.birth),
    parentPassword:a.parentPassword||'',
    parentMustChange:a.parentMustChange ?? !a.parentPassword
  }))
  state.coaches ||= [{id:'PLT-0001',name:'Pelatih Utama',username:'pelatih',password:'123456',active:true,mustChangePassword:true}]
  state.coaches = state.coaches.map(c=>({...c,photo:c.photo||'',mustChangePassword:c.mustChangePassword ?? true}))
  state.settings ||= {}
  state.settings.logo ||= ''
  state.athletes = state.athletes.map(a=>({
    ...a,
    trainingCategory:a.trainingCategory||'Pemula',
    trainingGroups:Array.isArray(a.trainingGroups)?a.trainingGroups:(a.ageGroup?[a.ageGroup]:[])
  }))
  state.pendingRegistrations ||= []
  state.weeklyTargets ||= []
  state.skillJournals ||= []
  state.drylandTasks ||= []
  state.rescheduleRequests ||= []
  state.athletePackages ||= []
  state.parentReminders ||= {}
  state.settings ||= {}
  state.settings.adminUsername ||= 'admin'
  state.settings.adminPassword ||= '123456'
  state.invoices ||= []
  state.coachSalaries ||= []
  state.coachNotifications ||= []
  state.notifications ||= []
  state.auditTrail ||= []
  state.versionHistory ||= []
  state.__tombstones ||= {}
  state.timeRecords ||= []; state.trainingPrograms ||= []; state.attendance ||= []; state.schedules ||= []; state.payments ||= []; state.competitions ||= []; state.competitionRegistrations ||= []; state.announcements ||= []
}
const MODULE_CACHE_KEYS={
  athletes:'asc_cache_athletes',attendance:'asc_cache_attendance',timeRecords:'asc_cache_time_records',
  trainingPrograms:'asc_cache_training_programs',payments:'asc_cache_payments',schedules:'asc_cache_schedules',
  announcements:'asc_cache_announcements',coaches:'asc_cache_coaches',pendingRegistrations:'asc_cache_registrations',
  notifications:'asc_cache_notifications',coachNotifications:'asc_cache_coach_notifications',financeTransactions:'asc_cache_finance_transactions',competitions:'asc_cache_competitions',
  competitionRegistrations:'asc_cache_competition_registrations',weeklyTargets:'asc_cache_weekly_targets',
  skillJournals:'asc_cache_skill_journals',drylandTasks:'asc_cache_dryland_tasks',rescheduleRequests:'asc_cache_reschedule_requests',
  athletePackages:'asc_cache_athlete_packages',invoices:'asc_cache_invoices',coachSalaries:'asc_cache_coach_salaries',
  auditTrail:'asc_cache_audit_trail',versionHistory:'asc_cache_version_history',parentReminders:'asc_cache_parent_reminders'
}
const INVOICE_TOMBSTONE_CACHE_KEY='asc_cache_invoice_tombstones'
const COMPETITION_TOMBSTONE_CACHE_KEY='asc_cache_competition_tombstones'
function cacheSafeClone(value){
  if(Array.isArray(value))return value.map(cacheSafeClone)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cacheSafeClone(item)]))
  if(typeof value==='string'&&value.startsWith('data:')&&value.length>2048)return ''
  return value
}
function safeLocalStorageSet(key,value){
  try{localStorage.setItem(key,value);return true}
  catch(error){console.warn(`Cache lokal ${key} tidak dapat ditulis tanpa melewati quota. Data Supabase tetap aman.`,error);return false}
}
function localMetadata(){
  return {
    storageVersion:2,
    login:{role:role||''},
    session:{role:role||'',parentAthleteId:parentAthleteId||'',coachId:coachId||'',currentPage:currentPage||'dashboard'},
    settings:cacheSafeClone(state.settings||{}),
    __sync:cacheSafeClone(state.__sync||{}),
    theme:String(state.theme||localStorage.getItem('asc_theme')||''),
    cache:{updatedAt:new Date().toISOString(),keys:Object.values(MODULE_CACHE_KEYS)}
  }
}
function saveModuleCaches(){
  Object.entries(MODULE_CACHE_KEYS).forEach(([collection,key])=>{
    const value=state[collection]
    if(value===undefined)return
    safeLocalStorageSet(key,JSON.stringify(cacheSafeClone(value)))
  })
}
function loadModuleCachesIntoState(legacyState=null){
  Object.entries(MODULE_CACHE_KEYS).forEach(([collection,key])=>{
    try{
      const legacyValue=legacyState?.[collection]
      const cached=JSON.parse(localStorage.getItem(key)||'null')
      if(legacyValue!==undefined)state[collection]=structuredClone(legacyValue)
      else if(cached!==null)state[collection]=cached
    }catch(error){console.warn(`Cache lokal ${key} tidak dapat dibaca.`,error)}
  })
}
function compactLegacySafetySnapshots(){
  try{
    const list=JSON.parse(localStorage.getItem('asc_safety_snapshots')||'[]')
    if(!Array.isArray(list)||!list.length)return
    const compact=list.slice(0,3).map(item=>({savedAt:item?.savedAt||'',revision:Number(item?.revision||item?.payload?.__sync?.revision||0),counts:item?.counts||{}}))
    safeLocalStorageSet('asc_safety_snapshots',JSON.stringify(compact))
  }catch(error){console.warn('Snapshot lama tidak dapat dipadatkan.',error)}
}
function saveLocal(){
  // aqilah_sc_data hanya metadata kecil. Data operasional disimpan per modul.
  safeLocalStorageSet('aqilah_sc_data',JSON.stringify(localMetadata()))
  saveModuleCaches()
  safeLocalStorageSet(INVOICE_TOMBSTONE_CACHE_KEY,JSON.stringify(cacheSafeClone(state.__tombstones?.invoices||{})))
  safeLocalStorageSet(COMPETITION_TOMBSTONE_CACHE_KEY,JSON.stringify(cacheSafeClone(state.__tombstones?.competitions||{})))
}
function loadLocal(){
  let stored=null
  try{stored=JSON.parse(localStorage.getItem('aqilah_sc_data')||'null')}catch(error){console.warn('Metadata lokal tidak dapat dibaca.',error)}
  state=structuredClone(defaultState)
  Object.keys(MODULE_CACHE_KEYS).forEach(collection=>{state[collection]=collection==='parentReminders'?{}:[]})
  if(stored?.settings)state.settings={...state.settings,...stored.settings}
  if(stored?.__sync)state.__sync=stored.__sync
  if(stored?.theme)state.theme=stored.theme
  // Migrasi satu kali dari format lama yang masih berisi seluruh state.
  loadModuleCachesIntoState(stored?.storageVersion===2?null:stored)
  state.__tombstones ||= {}
  try{state.__tombstones.invoices=JSON.parse(localStorage.getItem(INVOICE_TOMBSTONE_CACHE_KEY)||'{}')}catch(error){console.warn('Cache tombstone tagihan tidak dapat dibaca.',error)}
  try{state.__tombstones.competitions=JSON.parse(localStorage.getItem(COMPETITION_TOMBSTONE_CACHE_KEY)||'{}')}catch(error){console.warn('Cache tombstone event tidak dapat dibaca.',error)}
  normalize()
  compactLegacySafetySnapshots()
  saveLocal()
}


// TAHAP 1: mode anti-kehilangan data.
// Sebelum seluruh payload disimpan, data terbaru dari Supabase digabungkan
// berdasarkan ID. Item yang hanya ada di HP/website lain tetap dipertahankan.
const PERSISTENT_COLLECTIONS = [
  'athletes','coaches','pendingRegistrations','weeklyTargets','skillJournals',
  'drylandTasks','rescheduleRequests','athletePackages','invoices',
  'coachSalaries','coachNotifications','notifications','financeTransactions','timeRecords',
  'trainingPrograms','attendance','schedules','payments','competitions',
  'competitionRegistrations','announcements','auditTrail','versionHistory'
]
function recordIdentity(item,index=0){
  if(item && typeof item==='object'){
    return String(item.id || item.paymentId || item.registrationId || item.invoiceId ||
      item.athleteId && item.date && `${item.athleteId}|${item.date}|${item.type||item.stroke||''}` ||
      item.athleteId && item.month && `${item.athleteId}|${item.month}|${item.paymentType||''}` ||
      item.coachId && item.period && `${item.coachId}|${item.period}` || '')
  }
  return `index-${index}-${JSON.stringify(item)}`
}
function mergeCollection(remoteList=[],localList=[],tombstones={}){
  const merged=new Map()
  ;(Array.isArray(remoteList)?remoteList:[]).forEach((item,index)=>{
    const key=recordIdentity(item,index)
    if(!tombstones[key])merged.set(key,structuredClone(item))
  })
  ;(Array.isArray(localList)?localList:[]).forEach((item,index)=>{
    const key=recordIdentity(item,index)
    if(tombstones[key])return
    const old=merged.get(key)
    merged.set(key,old && typeof old==='object' && typeof item==='object' ? {...old,...structuredClone(item)} : structuredClone(item))
  })
  return [...merged.values()]
}
function mergeStateWithoutLoss(remotePayload,localPayload){
  const remote=remotePayload && typeof remotePayload==='object' ? remotePayload : {}
  const local=localPayload && typeof localPayload==='object' ? localPayload : {}
  const merged={...structuredClone(defaultState),...structuredClone(remote),...structuredClone(local)}
  merged.__tombstones={...(remote.__tombstones||{}),...(local.__tombstones||{})}
  PERSISTENT_COLLECTIONS.forEach(key=>{ merged[key]=mergeCollection(remote[key],local[key],merged.__tombstones[key]||{}) })
  merged.settings={...(remote.settings||{}),...(local.settings||{})}
  merged.parentReminders={...(remote.parentReminders||{}),...(local.parentReminders||{})}
  merged.__sync={...(remote.__sync||{}),...(local.__sync||{}),clientId:CLIENT_ID,savedAt:new Date().toISOString()}
  return merged
}
function currentActor(){
  if(role==='admin')return state.settings?.coachName||'Admin'
  if(role==='coach')return currentCoach()?.name||'Pelatih'
  if(role==='parent')return parentAthlete()?.name||'Orang Tua'
  return 'Sistem'
}
function addAudit(action,collection='',recordId='',detail=''){
  state.auditTrail ||= []
  state.auditTrail.unshift({id:createId(),at:new Date().toISOString(),actor:currentActor(),role:role||'system',action,collection,recordId:String(recordId||''),detail:String(detail||'')})
  state.auditTrail=state.auditTrail.slice(0,500)
}
function addVersionSnapshot(reason='perubahan'){
  state.versionHistory ||= []
  state.versionHistory.unshift({id:createId(),at:new Date().toISOString(),reason,revision:Number(state.__sync?.revision||0),counts:Object.fromEntries(PERSISTENT_COLLECTIONS.filter(k=>k!=='versionHistory').map(k=>[k,Array.isArray(state[k])?state[k].length:0]))})
  state.versionHistory=state.versionHistory.slice(0,100)
}
function softDelete(collection,id,detail=''){
  if(!Array.isArray(state[collection]))return false
  const index=state[collection].findIndex((item,i)=>recordIdentity(item,i)===String(id)||String(item?.id||'')===String(id))
  if(index<0)return false
  const record=state[collection][index]
  const identity=recordIdentity(record,index)
  state.__tombstones ||= {}; state.__tombstones[collection] ||= {}
  state.__tombstones[collection][identity]={deletedAt:new Date().toISOString(),clientId:CLIENT_ID,actor:currentActor()}
  state[collection].splice(index,1)
  addAudit('Hapus',collection,identity,detail||record?.name||record?.title||record?.athleteName||'')
  addVersionSnapshot(`Hapus ${collection}`)
  queueSave();render();return true
}
function downloadJsonFile(data,filename){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
  saveDownloadFile(blob,filename,'application/json')
}
function systemHealth(){
  const lastJournal=JSON.parse(localStorage.getItem('asc_recovery_journal')||'[]')[0]
  return {
    database:navigator.onLine?'Terhubung':'Offline',
    realtime:syncStatus,
    localBackup:localStorage.getItem('asc_safety_snapshots')?'Tersedia':'Belum tersedia',
    journal:lastJournal?.event||'Belum ada',
    pending:pendingRemoteSave?'Menunggu sinkronisasi':'Tidak ada antrean',
    revision:Number(state.__sync?.revision||0)
  }
}
function restoreLatestSafetySnapshot(){
  const list=JSON.parse(localStorage.getItem('asc_safety_snapshots')||'[]')
  const latest=list[0]
  if(!latest)throw new Error('Snapshot pengaman belum tersedia.')
  loadModuleCachesIntoState()
  normalize();addAudit('Pemulihan','system','snapshot','Memuat ulang cache per modul terbaru');queueSave()
}

function saveSafetySnapshot(snapshot){
  try{
    const list=JSON.parse(localStorage.getItem('asc_safety_snapshots')||'[]')
    const entry={savedAt:new Date().toISOString(),revision:Number(snapshot?.__sync?.revision||0),counts:Object.fromEntries(Object.keys(MODULE_CACHE_KEYS).map(key=>[key,Array.isArray(snapshot?.[key])?snapshot[key].length:0]))}
    safeLocalStorageSet('asc_safety_snapshots',JSON.stringify([entry,...list.map(item=>({savedAt:item.savedAt,revision:item.revision,counts:item.counts||{}}))].slice(0,3)))
  }catch(error){ console.warn('Snapshot pengaman lokal tidak dapat dibuat.',error) }
}

// TAHAP 2: verifikasi setelah simpan dan jurnal pemulihan lokal.
// Aplikasi baru menyatakan sinkron berhasil bila seluruh ID penting yang dikirim
// benar-benar kembali dari Supabase. Jurnal disimpan terpisah dari state utama.
const CRITICAL_COLLECTIONS = [
  'pendingRegistrations','competitionRegistrations','coachSalaries','competitions'
]
function collectionIds(payload,key){
  const rows=Array.isArray(payload?.[key])?payload[key]:[]
  return new Set(rows.map((item,index)=>recordIdentity(item,index)).filter(Boolean))
}
function verifyCriticalCollections(expected,received){
  const missing=[]
  CRITICAL_COLLECTIONS.forEach(key=>{
    const actual=collectionIds(received,key)
    collectionIds(expected,key).forEach(id=>{if(!actual.has(id))missing.push(`${key}:${id}`)})
  })
  return missing
}
function appendRecoveryJournal(event,payload={}){
  try{
    const key='asc_recovery_journal'
    const current=JSON.parse(localStorage.getItem(key)||'[]')
    const entry={id:createId(),event,at:new Date().toISOString(),clientId:CLIENT_ID,...payload}
    localStorage.setItem(key,JSON.stringify([entry,...current].slice(0,100)))
  }catch(error){console.warn('Jurnal pemulihan lokal tidak dapat ditulis.',error)}
}
function criticalCounts(payload){
  return Object.fromEntries(CRITICAL_COLLECTIONS.map(key=>[key,Array.isArray(payload?.[key])?payload[key].length:0]))
}
let timer
let lastRemoteUpdatedAt = localStorage.getItem('asc_last_remote_updated_at') || ''
let remoteSaveInFlight = false
let realtimePollTimer = null
function stopFallbackPolling(){
  clearInterval(realtimePollTimer)
  realtimePollTimer=null
}
function startFallbackPolling(){
  if(realtimeActive||realtimePollTimer)return
  realtimePollTimer=setInterval(()=>{
    if(!realtimeActive&&navigator.onLine&&!pendingRemoteSave&&document.visibilityState==='visible')loadRemote({renderAfter:true})
  },15000)
}

function stampStateForSync() {
  const currentRevision = Number(state.__sync?.revision || 0)
  state.__sync = {
    clientId: CLIENT_ID,
    revision: currentRevision + 1,
    savedAt: new Date().toISOString()
  }
}
function rememberRemoteTimestamp(value='') {
  if(!value)return
  lastRemoteUpdatedAt=value
  trySetLocalStorage('asc_last_remote_updated_at',value)
}
function queueSave() {
  // Simpan lokal terlebih dahulu agar perubahan dari HP/komputer tidak hilang
  // saat internet lambat. Supabase lalu disinkronkan otomatis di belakang layar.
  stampStateForSync()
  saveSafetySnapshot(state)
  saveLocal()
  pendingRemoteSave = true
  syncStatus = navigator.onLine ? 'Perubahan tersimpan, menyinkronkan...' : 'Perubahan tersimpan di perangkat'
  updateSync()
  clearTimeout(timer)
  timer=setTimeout(saveRemote,250)
}
function scheduleRemoteRetry(delay=4000) {
  clearTimeout(retryTimer)
  retryTimer=setTimeout(()=>{ if(pendingRemoteSave && navigator.onLine) saveRemote() },delay)
}
async function saveRemote() {
  if(remoteSaveInFlight)return
  if(!navigator.onLine){
    syncStatus='Perubahan tersimpan di perangkat';updateSync();scheduleRemoteRetry();return
  }
  remoteSaveInFlight=true
  const localSnapshot=structuredClone(state)
  const snapshotRevision=Number(localSnapshot.__sync?.revision||0)
  try {
    // Koleksi utama disimpan per baris agar input bersamaan tidak saling menimpa.
    await saveRowCollections(localSnapshot)
    // Selalu baca payload terbaru sebelum menulis. Ini mencegah HP A
    // menimpa catatan yang baru saja disimpan dari HP B atau website.
    const {data:latestRow,error:latestError}=await supabase
      .from(DATA_TABLE)
      .select('payload')
      .eq('class_id',CLUB_ID)
      .maybeSingle()
    if(latestError)throw latestError
    const snapshot=mergeStateWithoutLoss(latestRow?.payload,localSnapshot)
    // Data Atlet sekarang dimiliki asc_athletes. Pertahankan nilai legacy apa adanya
    // agar penyimpanan menu lain tidak menulis ulang atau menghapus fallback lama.
    DEDICATED_COLLECTION_KEYS.forEach(key=>{
      if(Array.isArray(latestRow?.payload?.[key]))snapshot[key]=structuredClone(latestRow.payload[key])
      else delete snapshot[key]
    })
    snapshot.__sync.revision=Math.max(
      Number(latestRow?.payload?.__sync?.revision||0),
      snapshotRevision
    )+1
    saveSafetySnapshot(snapshot)
    appendRecoveryJournal('before-remote-save',{revision:snapshot.__sync.revision,counts:criticalCounts(snapshot)})
    const { data, error } = await supabase
      .from(DATA_TABLE)
      .upsert({
        class_id:CLUB_ID,
        payload:snapshot,
        updated_at:new Date().toISOString()
      },{onConflict:'class_id'})
      .select('updated_at,payload')
      .single()
    if(error) throw error
    const missingAfterSave=verifyCriticalCollections(snapshot,data?.payload)
    if(missingAfterSave.length){
      appendRecoveryJournal('remote-verification-failed',{revision:snapshot.__sync.revision,missing:missingAfterSave.slice(0,50),counts:criticalCounts(snapshot)})
      throw new Error(`Verifikasi Supabase gagal. ${missingAfterSave.length} data penting belum kembali dari server.`)
    }
    appendRecoveryJournal('remote-save-verified',{revision:snapshot.__sync.revision,counts:criticalCounts(data?.payload)})
    rememberRemoteTimestamp(data?.updated_at)
    // Terapkan hasil gabungan kembali ke perangkat, sehingga data unik dari
    // perangkat lain langsung ikut tersimpan lokal dan tidak menghilang.
    if(data?.payload){
      const payloadChanged=applyRemotePayloadPreservingDedicated(data.payload)
      if(payloadChanged){normalize();saveLocal()}
      await loadRowCollections()
    }
    // Jangan menandai selesai jika ada perubahan baru saat proses upload berlangsung.
    pendingRemoteSave = Number(state.__sync?.revision||0) > Number(data?.payload?.__sync?.revision||snapshotRevision)
    syncStatus=pendingRemoteSave?'Ada perubahan baru, menyinkronkan...':'HP dan website sudah tersinkron'
    if(pendingRemoteSave)scheduleRemoteRetry(150)
  } catch(error) {
    appendRecoveryJournal('remote-save-error',{message:error?.message||String(error),counts:criticalCounts(localSnapshot)})
    console.warn('Sinkronisasi Supabase akan dicoba kembali.',error)
    pendingRemoteSave=true
    syncStatus='Perubahan tersimpan, menunggu koneksi Supabase'
    scheduleRemoteRetry()
  } finally {
    remoteSaveInFlight=false
    updateSync()
  }
}
async function loadRemote({renderAfter=false,attempt=1}={}) {
  let changed=false
  try {
    const { data, error } = await supabase
      .from(DATA_TABLE)
      .select('payload,updated_at')
      .eq('class_id',CLUB_ID)
      .maybeSingle()
    if(error) throw error
    if(data?.payload){
      const remoteRevision=Number(data.payload.__sync?.revision||0)
      const localRevision=Number(state.__sync?.revision||0)
      const isOwnPending=data.payload.__sync?.clientId===CLIENT_ID && remoteRevision<localRevision
      const remoteTimestamp=String(data.updated_at||'')
      const hasNewRemoteVersion=Boolean(remoteTimestamp && remoteTimestamp!==lastRemoteUpdatedAt)
      const stateActuallyChanged=remoteRevision!==localRevision || data.payload.__sync?.clientId!==state.__sync?.clientId
      // Jangan render ulang hanya karena polling 15 detik. Halaman diperbarui
      // hanya bila timestamp/revisi Supabase benar-benar berubah.
      if(!pendingRemoteSave && !isOwnPending && hasNewRemoteVersion && stateActuallyChanged){
        const payloadChanged=applyRemotePayloadPreservingDedicated(data.payload)
        if(payloadChanged){normalize();saveLocal();changed=true}
      }
      rememberRemoteTimestamp(remoteTimestamp)
    } else {
      pendingRemoteSave=true
      await saveRemote()
    }
    const rowsChanged=await loadRowCollections()
    changed=changed||rowsChanged
    if(renderAfter&&changed)renderRemoteUpdateSafely()
    syncStatus=pendingRemoteSave?'Perubahan lokal menunggu sinkronisasi':'HP dan website sudah tersinkron'
  } catch(error) {
    const message=error?.message||error?.details||String(error||'Koneksi gagal')
    if(attempt<3 && navigator.onLine){
      syncStatus=`Menghubungkan Supabase (${attempt}/3)...`
      updateSync()
      await new Promise(resolve=>setTimeout(resolve,700*attempt))
      return loadRemote({renderAfter,attempt:attempt+1})
    }
    console.error(`Supabase tidak dapat diakses setelah ${attempt} percobaan: ${message}`)
    syncStatus='Data perangkat aktif — periksa Supabase'
  }
  updateSync()
  return changed
}
async function handleRowRealtime(table,payload){
  if(pendingRemoteSave||isRecentLocalRowEvent(table,payload))return
  const changed=await loadRowCollections()
  if(changed){
    syncStatus='Pembaruan dari perangkat lain diterima'
    renderRemoteUpdateSafely()
  }
}
function subscribeRealtime() {
  if(unsubscribeRealtime){
    supabase.removeChannel(unsubscribeRealtime)
    unsubscribeRealtime=null
  }
  realtimeActive=false
  stopFallbackPolling()
  unsubscribeRealtime=supabase
    .channel(`asc-sync-${CLUB_ID}-${CLIENT_ID}`)
    .on('postgres_changes',{
      event:'*',schema:'public',table:DATA_TABLE,filter:`class_id=eq.${CLUB_ID}`
    },payload=>{
      const remote=payload.new?.payload
      const updatedAt=payload.new?.updated_at
      if(!remote)return
      rememberRemoteTimestamp(updatedAt)
      const remoteRevision=Number(remote.__sync?.revision||0)
      const localRevision=Number(state.__sync?.revision||0)
      const fromThisDevice=remote.__sync?.clientId===CLIENT_ID
      if(fromThisDevice && remoteRevision<=localRevision){
        syncStatus=pendingRemoteSave?'Ada perubahan baru, menyinkronkan...':'HP dan website sudah tersinkron'
        updateSync();return
      }
      // Jika perangkat ini sedang memiliki perubahan yang belum terkirim, jangan timpa.
      // Sesudah upload selesai, pembaruan perangkat lain akan masuk melalui realtime/polling.
      if(pendingRemoteSave){
        syncStatus='Menyelesaikan perubahan perangkat ini...'
        updateSync();scheduleRemoteRetry(100);return
      }
      if(remoteRevision===localRevision && remote.__sync?.clientId===state.__sync?.clientId){
        syncStatus='HP dan website sudah tersinkron'
        updateSync();return
      }
      const changed=applyRemotePayloadPreservingDedicated(remote)
      if(!changed){
        syncStatus='HP dan website sudah tersinkron'
        updateSync();return
      }
      normalize();saveLocal()
      syncStatus='Pembaruan dari perangkat lain diterima'
      renderRemoteUpdateSafely()
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_athletes'},payload=>handleRowRealtime('asc_athletes',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_attendance'},payload=>handleRowRealtime('asc_attendance',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_payments'},payload=>handleRowRealtime('asc_payments',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_training_programs'},payload=>handleRowRealtime('asc_training_programs',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_time_records'},payload=>handleRowRealtime('asc_time_records',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_announcements'},payload=>handleRowRealtime('asc_announcements',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_schedules'},payload=>handleRowRealtime('asc_schedules',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_coaches'},payload=>handleRowRealtime('asc_coaches',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_registrations'},payload=>handleRowRealtime('asc_registrations',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_notifications'},payload=>handleRowRealtime('asc_notifications',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_finance_transactions'},payload=>handleRowRealtime('asc_finance_transactions',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'asc_competitions'},payload=>handleRowRealtime('asc_competitions',payload))
    .subscribe(status=>{
      if(status==='SUBSCRIBED'){
        realtimeActive=true
        stopFallbackPolling()
        syncStatus=pendingRemoteSave?'Menyinkronkan perubahan...':'Sinkronisasi HP dan website aktif'
        updateSync()
      }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
        realtimeActive=false
        startFallbackPolling()
      }
    })
  // Polling hanya menjadi cadangan selama kanal realtime belum aktif/gagal.
  startFallbackPolling()
}
window.addEventListener('online',()=>{syncStatus='Internet tersambung, menyinkronkan...';updateSync();flushFinanceOfflineQueue();if(pendingRemoteSave)saveRemote();else loadRemote({renderAfter:true})})
window.addEventListener('offline',()=>{syncStatus='Offline — perubahan tetap tersimpan di perangkat';updateSync()})
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&navigator.onLine){
    if(pendingRemoteSave)saveRemote();else loadRemote({renderAfter:true})
  }
})
window.addEventListener('pagehide',()=>{if(pendingRemoteSave&&navigator.onLine)saveRemote()})
document.addEventListener('focusout',()=>setTimeout(finishDeferredRemoteRender,150),true)
function updateSync() { const e=document.querySelector('#syncBadge');if(e)e.textContent=syncStatus }
const STORAGE_BUCKET = 'asc-uploads'
function safeFilePart(value='file'){
  return String(value).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'file'
}
function fileExtension(file, fallback='bin'){
  const fromName=String(file?.name||'').split('.').pop()?.toLowerCase()
  if(fromName && fromName!==String(file?.name||'').toLowerCase() && /^[a-z0-9]{1,8}$/.test(fromName))return fromName
  const mime=String(file?.type||'').toLowerCase()
  const known={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','application/pdf':'pdf'}
  return known[mime]||fallback
}
async function uploadBlobToStorage(blob, originalFile, folder='general', extension='bin'){
  if(!navigator.onLine)throw new Error('Upload memerlukan koneksi internet. Sambungkan internet lalu coba lagi.')
  const path=`${safeFilePart(CLUB_ID)}/${safeFilePart(folder)}/${new Date().toISOString().slice(0,10)}/${Date.now()}-${createId()}-${safeFilePart(String(originalFile?.name||'file').replace(/\.[^.]+$/,''))}.${extension}`
  const {error}=await supabase.storage.from(STORAGE_BUCKET).upload(path,blob,{contentType:blob.type||originalFile?.type||'application/octet-stream',cacheControl:'3600',upsert:false})
  if(error)throw new Error(`Upload gagal: ${error.message||'periksa konfigurasi Supabase Storage.'}`)
  const {data}=supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  if(!data?.publicUrl)throw new Error('Alamat file hasil upload tidak tersedia.')
  return data.publicUrl
}
async function compressImage(file,max=900){
  const isImage=String(file?.type||'').startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(String(file?.name||''))
  if(!isImage)throw new Error('File harus berupa foto.')
  if(file.size>12*1024*1024)throw new Error('Ukuran foto maksimal 12 MB.')
  const objectUrl=URL.createObjectURL(file)
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Foto tidak dapat dibaca. Gunakan JPG, PNG, atau WebP.'));i.src=objectUrl})
    const scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale))
    canvas.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale))
    const ctx=canvas.getContext('2d',{alpha:false})
    ctx.drawImage(img,0,0,canvas.width,canvas.height)
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Foto gagal diproses.')),'image/jpeg',0.82))
  } finally { URL.revokeObjectURL(objectUrl) }
}
async function imageData(file,max=900,folder='images') {
  if(!file||!file.size)return ''
  const blob=await compressImage(file,max)
  return uploadBlobToStorage(blob,file,folder,'jpg')
}
async function fileData(file, maxBytes=8*1024*1024, folder='documents') {
  if(!file||!file.size)return ''
  if(file.size>maxBytes)throw new Error(`Ukuran file maksimal ${Math.round(maxBytes/1024/1024)} MB.`)
  return uploadBlobToStorage(file,file,folder,fileExtension(file))
}
async function registrationUpload(file, type, ownerId='') {
  if(!file||!file.size)return ''
  const supportedDocuments=['certificate','birth-certificate','family-card','registration-proof','coach-salary','payment','competition-payment']
  const folder=[type||'uploads',ownerId?safeFilePart(ownerId):''].filter(Boolean).join('/')
  const isImage=String(file.type||'').startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(String(file.name||''))
  if(isImage)return imageData(file,type==='photo'?500:1200,folder)
  const isPdf=String(file.type||'')==='application/pdf' || /\.pdf$/i.test(String(file.name||''))
  if(supportedDocuments.includes(type)&&isPdf)return fileData(file,8*1024*1024,folder)
  throw new Error(supportedDocuments.includes(type)?'Berkas harus berupa gambar atau PDF.':'File tidak didukung.')
}
function setFormBusy(form,busy,label='Menyimpan...'){
  if(!form)return
  const buttons=[...form.querySelectorAll('button[type="submit"],input[type="submit"]')]
  buttons.forEach(button=>{
    if(busy){button.dataset.originalLabel=button.tagName==='INPUT'?button.value:button.textContent;button.disabled=true;if(button.tagName==='INPUT')button.value=label;else button.textContent=label}
    else{button.disabled=false;const original=button.dataset.originalLabel;if(original){if(button.tagName==='INPUT')button.value=original;else button.textContent=original;delete button.dataset.originalLabel}}
  })
}
async function verifyRemoteRecord(collection,id,timeoutMs=18000){
  const started=Date.now()
  let lastError=null
  while(Date.now()-started<timeoutMs){
    try{
      const rowCfg=ROW_COLLECTIONS[collection]
      if(rowCfg){
        const {data,error}=await supabase.from(rowCfg.table).select('legacy_id').eq('legacy_id',String(id)).is('deleted_at',null).maybeSingle()
        if(error)throw error
        if(data?.legacy_id)return true
      }else{
        const {data,error}=await supabase.from(DATA_TABLE).select('payload').eq('class_id',CLUB_ID).maybeSingle()
        if(error)throw error
        if((data?.payload?.[collection]||[]).some(item=>String(item?.id)===String(id)))return true
      }
    }catch(error){lastError=error;console.error(`Verifikasi Supabase ${collection}:${id} gagal:`,error)}
    await new Promise(resolve=>setTimeout(resolve,900))
  }
  return {verified:false,error:lastError}
}
async function commitCriticalRecord(collection,id){
  if(DEDICATED_COLLECTION_KEYS.has(collection)){
    stampStateForSync();saveSafetySnapshot(state);saveLocal()
    if(!navigator.onLine)return false
    const record=state[collection].find(item=>String(item.id)===String(id))
    if(!record)throw new Error(`Record ${collection}:${id} tidak ditemukan di perangkat.`)
    if(collection==='athletes')await upsertAthleteRecord(record)
    else if(collection==='attendance')await upsertAttendanceRecord(record)
    else if(collection==='financeTransactions')await upsertFinanceRecord(record)
    else await upsertDedicatedRecord(collection,record)
  }else{
    queueSave()
    if(navigator.onLine)await saveRemote()
  }
  if(!navigator.onLine)return false
  const result=await verifyRemoteRecord(collection,id)
  if(result===true)return true
  const verified=Boolean(result?.verified)
  if(!verified){
    const original=result?.error?.message||result?.error?.details||'record tidak ditemukan setelah penyimpanan'
    console.error(`Data sudah diamankan di perangkat, tetapi belum terverifikasi di Supabase. ${collection}:${id}. Error asli:`,result?.error||original)
    throw new Error(`Data sudah diamankan di perangkat, tetapi belum terverifikasi di Supabase: ${original}`)
  }
  return true
}
async function deleteAthleteSafely(id){
  const index=state.athletes.findIndex(item=>String(item?.id)===String(id))
  if(index<0)return false
  const record=state.athletes[index]
  state.__tombstones ||= {};state.__tombstones.athletes ||= {}
  state.__tombstones.athletes[String(id)]={deletedAt:new Date().toISOString(),clientId:CLIENT_ID,actor:currentActor()}
  state.athletes.splice(index,1)
  addAudit('Hapus','athletes',id,record?.name||'')
  addVersionSnapshot('Hapus athletes')
  stampStateForSync();saveSafetySnapshot(state);saveLocal();render()
  if(!navigator.onLine)return true
  await softDeleteAthleteRecord(id)
  return true
}
async function deleteAttendanceSafely(id){
  const index=state.attendance.findIndex(item=>String(item?.id)===String(id))
  if(index<0)return false
  const record=state.attendance[index]
  state.__tombstones ||= {};state.__tombstones.attendance ||= {}
  state.__tombstones.attendance[String(id)]={deletedAt:new Date().toISOString(),clientId:CLIENT_ID,actor:currentActor()}
  state.attendance.splice(index,1)
  addAudit('Hapus','attendance',id,`${record?.athleteName||record?.athleteId||''} ${record?.date||''}`.trim())
  addVersionSnapshot('Hapus attendance')
  stampStateForSync();saveSafetySnapshot(state);saveLocal();render()
  if(!navigator.onLine)return true
  await softDeleteAttendanceRecord(id)
  return true
}
async function deleteInvoiceSafely(id){
  const index=state.invoices.findIndex(item=>String(item?.id)===String(id))
  if(index<0)return false
  if(!navigator.onLine)throw new Error('Tagihan belum dihapus karena perangkat sedang offline. Sambungkan internet lalu coba kembali.')
  await softDeleteDedicatedRecord('invoices',id)
  const record=state.invoices[index]
  state.__tombstones ||= {};state.__tombstones.invoices ||= {}
  state.__tombstones.invoices[String(id)]={deletedAt:new Date().toISOString(),clientId:CLIENT_ID,actor:currentActor()}
  state.invoices.splice(index,1)
  addAudit('Hapus','invoices',id,record?.title||record?.athleteName||'')
  addVersionSnapshot('Hapus invoices')
  stampStateForSync();saveSafetySnapshot(state);saveLocal();render()
  return true
}
async function deleteCompetitionSafely(id){
  const index=state.competitions.findIndex(item=>String(item?.id)===String(id))
  if(index<0)return false
  if(!navigator.onLine)throw new Error('Event belum dihapus karena perangkat sedang offline. Sambungkan internet lalu coba kembali.')
  await softDeleteDedicatedRecord('competitions',id)
  const record=state.competitions[index]
  state.__tombstones ||= {};state.__tombstones.competitions ||= {}
  state.__tombstones.competitions[String(id)]={deletedAt:new Date().toISOString(),clientId:CLIENT_ID,actor:currentActor()}
  state.competitions.splice(index,1)
  addAudit('Hapus','competitions',id,record?.title||'')
  addVersionSnapshot('Hapus competitions')
  stampStateForSync();saveSafetySnapshot(state);saveLocal();render()
  return true
}
async function deleteDedicatedSafely(collection,id){
  if(collection==='athletes')return deleteAthleteSafely(id)
  if(collection==='attendance')return deleteAttendanceSafely(id)
  if(collection==='invoices')return deleteInvoiceSafely(id)
  if(collection==='competitions')return deleteCompetitionSafely(id)
  const list=state[collection]
  if(!Array.isArray(list))return false
  const index=list.findIndex(item=>String(item?.id)===String(id))
  if(index<0)return false
  const record=list[index]
  state.__tombstones ||= {};state.__tombstones[collection] ||= {}
  state.__tombstones[collection][String(id)]={deletedAt:new Date().toISOString(),clientId:CLIENT_ID,actor:currentActor()}
  list.splice(index,1)
  addAudit('Hapus',collection,id,record?.name||record?.title||record?.athleteName||'')
  addVersionSnapshot(`Hapus ${collection}`)
  stampStateForSync();saveSafetySnapshot(state);saveLocal();render()
  if(!navigator.onLine)return true
  await softDeleteDedicatedRecord(collection,id)
  return true
}
function persistDedicatedSoon(collection,id){
  commitCriticalRecord(collection,id).catch(error=>console.error(`Sinkronisasi ${collection}:${id} gagal:`,error))
}
function registrationStatusLabel(status){
  return status==='approved'?'Disetujui':status==='rejected'?'Ditolak':'Menunggu Konfirmasi'
}
function addAdminNotification(type,title,message,target){
  const notification={id:createId(),type,title,message,target,notificationAudience:'admin',createdAt:new Date().toISOString(),read:false}
  state.notifications.unshift(notification)
  persistDedicatedSoon('notifications',notification.id)
  sendPushNotification({target:'admin',title,message,page:target,eventId:notification.id,inApp:false})
  return notification
}
function financeRecordId(direction,referenceType,referenceId){return `FIN-${direction}-${referenceType}-${referenceId}`.replace(/[^A-Za-z0-9_-]/g,'-')}
function normalizeFinanceCategory(value='LAINNYA'){const text=String(value).toUpperCase();if(text.includes('SPP'))return 'SPP';if(text.includes('LOMBA')||text.includes('COMPETITION'))return 'LOMBA';if(text.includes('PENDAFTAR'))return 'PENDAFTARAN';if(text.includes('GAJI')||text.includes('SALARY'))return 'GAJI';return text||'LAINNYA'}
const FINANCE_OFFLINE_QUEUE_KEY='asc_finance_offline_queue'
function financeOfflineQueue(){try{return JSON.parse(localStorage.getItem(FINANCE_OFFLINE_QUEUE_KEY)||'[]')}catch{return []}}
function queueFinanceOffline(id){safeLocalStorageSet(FINANCE_OFFLINE_QUEUE_KEY,JSON.stringify([...new Set([...financeOfflineQueue(),String(id)])]))}
async function flushFinanceOfflineQueue(){
  if(!navigator.onLine)return
  const pending=financeOfflineQueue(),remaining=[]
  for(const id of pending){const item=state.financeTransactions.find(x=>String(x.id)===String(id));if(!item)continue;try{await upsertFinanceRecord(item)}catch(error){remaining.push(id);console.error(`Queue keuangan ${id} belum tersinkron:`,error)}}
  safeLocalStorageSet(FINANCE_OFFLINE_QUEUE_KEY,JSON.stringify(remaining))
}
async function upsertFinanceReference({direction='income',referenceType,referenceId,amount=0,description='',category='',transactionType='',athleteId='',athleteName='',coachId='',coachName='',paymentId='',competitionId='',proofUrl='',transactionDate=new Date().toISOString()}){
  if(!referenceType||!referenceId)throw new Error('Referensi transaksi keuangan wajib tersedia.')
  const id=financeRecordId(direction,referenceType,referenceId)
  const item={id,direction,referenceType,referenceId,amount:Number(amount||0),description,category:normalizeFinanceCategory(category),transactionType,athleteId,athleteName,coachId,coachName,paymentId,competitionId,proofUrl,transactionDate,createdBy:currentActor(),createdRole:role||'system',createdDevice:PUSH_DEVICE_ID,updatedAt:new Date().toISOString()}
  const index=state.financeTransactions.findIndex(x=>x.id===id||(x.referenceType===referenceType&&String(x.referenceId)===String(referenceId)&&x.direction===direction))
  if(index>=0)state.financeTransactions[index]={...state.financeTransactions[index],...item,id:state.financeTransactions[index].id||id}
  else state.financeTransactions.push(item)
  const record=index>=0?state.financeTransactions[index]:item
  if(!navigator.onLine){stampStateForSync();saveLocal();queueFinanceOffline(record.id);syncStatus='Transaksi keuangan menunggu sinkronisasi';updateSync();return record}
  await commitCriticalRecord('financeTransactions',record.id)
  return record
}
async function deactivateFinanceReference(direction,referenceType,referenceId){
  const item=state.financeTransactions.find(x=>x.direction===direction&&x.referenceType===referenceType&&String(x.referenceId)===String(referenceId))
  if(item)await deleteDedicatedSafely('financeTransactions',item.id)
}
async function upsertTargetedNotification({recipientRole,recipientId,athleteId='',coachId='',title,message,type,referenceType,referenceId,page}){
  const id=`NTF-${recipientRole}-${recipientId||'all'}-${type}-${referenceType}-${referenceId}`.replace(/[^A-Za-z0-9_-]/g,'-')
  const list=recipientRole==='coach'?state.coachNotifications:state.notifications
  const index=list.findIndex(n=>n.id===id||(n.referenceType===referenceType&&String(n.referenceId)===String(referenceId)&&String(n.recipientId||n.coachId)===String(recipientId)&&n.type===type))
  const item={id,recipientRole,recipientId,athleteId:athleteId||(recipientRole==='parent'?recipientId:''),coachId:coachId||(recipientRole==='coach'?recipientId:''),title,message,type,referenceType,referenceId,page,deepLink:page,notificationAudience:recipientRole==='coach'?'coach':recipientRole,read:index>=0?Boolean(list[index].read):false,readAt:index>=0?list[index].readAt:null,createdAt:index>=0?list[index].createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  if(index>=0)list[index]={...list[index],...item};else list.unshift(item)
  await commitCriticalRecord(recipientRole==='coach'?'coachNotifications':'notifications',id)
  return item
}
function unreadNotifications(){return (state.notifications||[]).filter(n=>(n.notificationAudience||n.recipientRole||'admin')==='admin'&&!n.read).length}
function paymentStatusLabel(status){return status==='approved'?'Lunas':status==='rejected'?'Ditolak':'Menunggu Konfirmasi'}
function paymentTypeLabel(type){return type==='competition'?'Pembayaran Lomba':'Pembayaran SPP'}

function competitionPaymentExpiry(event){
  if(!event?.registrationDeadline)return null
  const deadline=new Date(`${event.registrationDeadline}T23:59:59.999`)
  if(Number.isNaN(deadline.getTime()))return null
  return new Date(deadline.getTime()+(7*24*60*60*1000))
}
function cleanupExpiredCompetitionPayments(now=new Date()){
  state.competitions ||= []
  state.competitionRegistrations ||= []
  state.payments ||= []
  const expiredEvents=state.competitions.filter(event=>{
    const expiry=competitionPaymentExpiry(event)
    return expiry && now.getTime()>expiry.getTime()
  })
  if(!expiredEvents.length)return {changed:false,registrations:0,payments:0}
  const expiredIds=new Set(expiredEvents.map(event=>String(event.id||'')))
  const expiredTitles=new Set(expiredEvents.map(event=>String(event.title||'').trim().toLowerCase()).filter(Boolean))
  let registrations=0
  state.competitionRegistrations.forEach(record=>{
    const matches=expiredIds.has(String(record.competitionId||'')) || expiredTitles.has(String(record.competitionTitle||'').trim().toLowerCase())
    if(!matches || record.paymentPurgedAt)return
    // Riwayat peserta, nominal, dan bukti tetap dipertahankan; hanya beri penanda arsip.
    record.paymentPurgedAt=now.toISOString()
    registrations+=1
  })
  let payments=0
  state.payments.forEach(payment=>{
    if(payment.paymentType!=='competition')return
    const matches=expiredIds.has(String(payment.competitionId||'')) || expiredTitles.has(String(payment.competitionName||'').trim().toLowerCase())
    if(!matches || payment.archivedAt)return
    // Riwayat pembayaran tetap dipertahankan. Event kedaluwarsa hanya diarsipkan.
    payment.archivedAt=now.toISOString()
    payment.archiveReason='Masa event dan periode pembayaran telah berakhir.'
    persistDedicatedSoon('payments',payment.id)
    payments+=1
  })
  if(registrations||payments)addAudit('Arsip Otomatis','competitionPayments','',`${registrations} pendaftaran dan ${payments} pembayaran diarsipkan tanpa dihapus.`)
  return {changed:registrations>0||payments>0,registrations,payments}
}
function invoiceStatusLabel(status){return status==='paid'?'Lunas':status==='cancelled'?'Dibatalkan':'Belum Dibayar'}
function nextInvoiceId(){return `INV-${Date.now()}`}

const TRAINING_CATEGORIES=['Pemula','Junior','Prestasi']
const TRAINING_GROUPS=['KU 5B','KU 5A','KU 4','KU 3','KU 2','KU 1']

function trainingCategoryOptions(selected=''){
 return TRAINING_CATEGORIES.map(x=>`<option value="${x}" ${selected===x?'selected':''}>${x}</option>`).join('')
}
function trainingGroupCheckboxes(selected=[]){
 const values=Array.isArray(selected)?selected:[]
 return TRAINING_GROUPS.map(x=>`<label class="check-pill"><input type="checkbox" name="trainingGroups" value="${x}" ${values.includes(x)?'checked':''}><span>${x}</span></label>`).join('')
}
function programAppliesToAthlete(program,athlete){
 const categories=Array.isArray(program.categories)?program.categories:[program.category].filter(Boolean)
 const groups=Array.isArray(program.trainingGroups)?program.trainingGroups:[]
 const categoryMatch=!categories.length||categories.includes('Semua Atlet')||categories.includes(athlete.trainingCategory)
 const athleteGroups=Array.isArray(athlete.trainingGroups)?athlete.trainingGroups:[athlete.ageGroup].filter(Boolean)
 const groupMatch=!groups.length||groups.some(g=>athleteGroups.includes(g))
 return categoryMatch&&groupMatch
}
function athleteOptions(selected='') { return state.athletes.map(a=>`<option value="${esc(a.id)}" ${selected===a.id?'selected':''}>${esc(a.id)} — ${esc(a.name)} — ${esc(a.ageGroup||calcGroup(a.birth))} — ${esc(a.schoolName||'-')}</option>`).join('') }
function athleteCombobox(name='athleteId',selected='',id=''){
 const listId=`athlete-list-${name}-${id||'default'}`
 return `<input ${id?`id="${id}"`:''} name="${name}" list="${listId}" value="${esc(selected)}" placeholder="Cari nama, ID, KU, atau sekolah" autocomplete="off" required><datalist id="${listId}">${state.athletes.map(a=>`<option value="${esc(a.id)}" label="${esc(`${a.id} — ${a.name} — ${a.ageGroup||calcGroup(a.birth)} — ${a.schoolName||'-'}`)}"></option>`).join('')}</datalist>`
}

function coachOptions(selected='') { return state.coaches.filter(c=>c.active!==false).map(c=>`<option value="${esc(c.id)}" ${selected===c.id?'selected':''}>${esc(c.name)}</option>`).join('') }
function currentCoach(){ return state.coaches.find(c=>c.id===coachId) }
function clubLogo(extraClass=''){
  const src=state.settings?.logo||'/asc-logo-final.png'
  return `<img class="club-logo-img ${extraClass}" src="${src}" alt="Logo AQILAH Swimming Club">`
}
function validAdminPassword(value){ return /^[A-Za-z0-9]{6}$/.test(String(value||'')) }
function validCoachPassword(value){ return /^[A-Za-z0-9]{6}$/.test(String(value||'')) }
function validParentPassword(value){ return /^[A-Za-z0-9]{6}$/.test(String(value||'')) }
function nextCoachId(){
  const max=(state.coaches||[]).reduce((n,c)=>Math.max(n,Number(String(c.id||'').replace(/\D/g,''))||0),0)
  return `PLT-${String(max+1).padStart(4,'0')}`
}

function loginPage() {
 app.innerHTML=`<main class="auth-page animated-login">
        <div class="auth-overlay"></div><section class="auth-wrap">
 <div class="auth-tabs login-hotspots"><button data-tab="admin" aria-label="Login Admin">Admin</button><button data-tab="coach" aria-label="Login Pelatih">Pelatih</button><button data-tab="parent" aria-label="Login Orang Tua">Orang Tua</button><button data-tab="register" aria-label="Pendaftaran Atlet Baru">Pendaftar Baru</button></div>
 <div id="authContent"></div></section></main>`
 const show=tab=>{document.querySelectorAll('.auth-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));const box=document.querySelector('#authContent')
 if(tab==='admin') box.innerHTML=`<form id="adminLogin" class="auth-card login-modal-card"><button type="button" class="login-modal-close" data-login-close>✕</button><h2>Login Admin</h2><label>Username Admin<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="current-password" required></label><button class="primary">Masuk sebagai Admin</button><p class="hint">Password Admin tepat 6 karakter, hanya huruf atau angka.</p><p id="authError" class="error"></p></form>`
 if(tab==='coach') box.innerHTML=`<form id="coachLogin" class="auth-card login-modal-card"><button type="button" class="login-modal-close" data-login-close>✕</button><h2>Login Pelatih</h2><label>Username<input name="username" required></label><label>Password<input name="password" type="password" required></label><button class="primary">Masuk sebagai Pelatih</button><p class="hint">Akun awal: pelatih / 123456</p><p id="authError" class="error"></p></form>`
 if(tab==='parent') box.innerHTML=`<form id="parentLogin" class="auth-card login-modal-card"><button type="button" class="login-modal-close" data-login-close>✕</button><h2>Login Orang Tua</h2><label>ID Atlet<input name="athleteId" required placeholder="Contoh: ASC-0001" autocomplete="username"></label><label>Password<input name="credential" type="password" required placeholder="Login pertama gunakan ID Atlet" autocomplete="current-password"></label><button class="primary">Masuk Portal Orang Tua</button><p class="hint">Login pertama memakai ID Atlet sebagai ID login dan password awal. Setelah berhasil masuk, wajib mengganti password menjadi tepat 6 karakter. Password boleh angka semua atau huruf semua.</p><p id="authError" class="error"></p></form>`
 if(tab==='register') box.innerHTML=`<form id="registerForm" class="auth-card register-card registration-form login-modal-card"><button type="button" class="login-modal-close" data-login-close>✕</button>
 <h2>Formulir Pendaftaran Atlet Baru</h2>
 <p class="hint">Lengkapi formulir dan unggah bukti pembayaran. Data atlet baru masuk ke data admin setelah pembayaran dikonfirmasi.</p>
 <img class="package-poster" src="./paket-pendaftaran-aqilah.jpg" onerror="this.onerror=null;this.src='paket-pendaftaran-aqilah.jpg'" alt="Paket pendaftaran AQILAH Swimming Club">
 <section class="package-notice">
   <h3>Paket Pendaftaran</h3>
   <div class="package-grid">
     <div><b>Paket 1</b><span>Pendaftaran Rp100.000</span><span>4× pertemuan/bulan</span><strong>Rp300.000/siswa</strong><small>Belum termasuk tiket masuk kolam</small></div>
     <div><b>Paket 2</b><span>Pendaftaran Rp100.000</span><span>8× pertemuan/bulan</span><strong>Rp600.000/siswa</strong><small>Belum termasuk tiket masuk kolam</small></div>
   </div>
 </section>
 <section class="bank-card"><b>Pembayaran melalui Bank Mandiri</b><span>Atas nama: FAHMI DJAWAS</span><strong>1560020198356</strong><small>Setelah membayar, unggah bukti pembayaran dan tunggu konfirmasi admin.</small></section>
 <div class="form-two">
   <label>Foto Atlet<input name="photo" type="file" accept="image/*" required></label>
   <label>Nama Atlet<input name="name" required></label>
   <label>Jenis Kelamin<select name="gender" required><option value="">Pilih jenis kelamin</option><option>Laki-Laki</option><option>Perempuan</option></select></label>
   <label>Tanggal Lahir<input name="birth" type="date" required></label>
   <label>Umur per 1 Januari 2026<input name="age" readonly placeholder="Otomatis"></label>
   <label>Kategori Kelas<select name="classCategory" required><option value="">Pilih kategori</option><option>Group</option><option>Private</option></select></label>
   <label>No. WhatsApp Orang Tua<input name="parentWhatsapp" inputmode="tel" required placeholder="Contoh: 081234567890"></label>
   <label class="full-field">Catatan Kesehatan<textarea name="healthNote" rows="3" placeholder="Alergi, riwayat penyakit, kebutuhan khusus, atau tulis Tidak ada" required></textarea></label>
   <label>Upload Akta Kelahiran<input name="certificate" type="file" accept="image/*,.pdf,application/pdf" required><small>Gambar atau PDF, maksimal 2 MB</small></label>
   <label>Upload Bukti Pembayaran<input name="paymentProof" type="file" accept="image/*" required><small>Gambar, maksimal 2 MB</small></label>
   <label>Pilih Paket<select name="package" required><option value="">Pilih paket</option><option value="Paket 1">Paket 1 — 4× pertemuan/bulan</option><option value="Paket 2">Paket 2 — 8× pertemuan/bulan</option></select></label>
   <div id="regAuto" class="auto-info">Umur dan kelompok usia muncul otomatis setelah tanggal lahir dipilih.</div>
 </div>
 <section class="registration-status-check"><h3>Cek Status Pendaftaran</h3><div class="status-check-row"><input id="registrationCodeInput" placeholder="Masukkan kode REG-..."><button type="button" class="secondary" id="checkRegistrationStatus">Cek Status</button></div><div id="registrationStatusResult" class="auto-info">Kode pendaftaran diberikan setelah formulir berhasil dikirim.</div></section>
 <label class="agreement"><input name="agreement" type="checkbox" required> Saya memahami bahwa pendaftaran menunggu verifikasi pembayaran oleh admin.</label>
 <div class="registration-dashboard-credit">Dashboard didesain oleh <strong>FAHMI DJAWAS</strong>. © 2026 Semua hak dilindungi</div>
 <button class="primary">Kirim Pendaftaran</button>
 <p id="registerError" class="error"></p>
 </form>`
 bindAuth(tab)
 document.querySelector('[data-login-close]')?.addEventListener('click',()=>{document.querySelector('#authContent').innerHTML='';document.querySelectorAll('.auth-tabs button').forEach(b=>b.classList.remove('active'))})
 }
 function bindAuth(tab){
  document.querySelector('#adminLogin')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const username=String(f.get('username')||'').trim();const password=String(f.get('password')||'');const errorBox=document.querySelector('#authError');if(username!==state.settings.adminUsername||password!==state.settings.adminPassword){errorBox.textContent='Username atau password Admin salah.';return}role='admin';currentPage='dashboard';persistActiveSession();syncStatus='Memuat data...';await loadRemote();syncStoredPushDevice();subscribeRealtime();render()})
  document.querySelector('#coachLogin')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const coach=state.coaches.find(c=>c.active!==false&&c.username===String(f.get('username'))&&c.password===String(f.get('password')));if(coach){role='coach';coachId=coach.id;currentPage=coach.mustChangePassword?'coachPassword':'coachDashboard';persistActiveSession();syncStoredPushDevice();render()}else document.querySelector('#authError').textContent='Username atau password pelatih salah.'})
  document.querySelector('#parentLogin')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const athleteId=String(f.get('athleteId')||'').trim().toUpperCase();const a=state.athletes.find(x=>String(x.id).toUpperCase()===athleteId);const credential=String(f.get('credential')||'');if(!a){document.querySelector('#authError').textContent='ID Atlet tidak ditemukan.';return}const firstLogin=!a.parentPassword;const valid=firstLogin?credential.toUpperCase()===String(a.id).toUpperCase():credential===a.parentPassword;if(!valid){document.querySelector('#authError').textContent=firstLogin?'Password awal harus sama dengan ID Atlet.':'Password orang tua salah.';return}a.parentMustChange=firstLogin;role='parent';parentAthleteId=a.id;currentPage=a.parentMustChange?'parentPassword':'parentDashboard';persistActiveSession();syncStoredPushDevice();render()})
  const birth=document.querySelector('#registerForm input[name="birth"]');birth?.addEventListener('input',()=>{
    const age=calcAge(birth.value),group=calcGroup(birth.value)
    const ageInput=document.querySelector('#registerForm input[name="age"]')
    if(ageInput)ageInput.value=birth.value?`${age} tahun`:''
    document.querySelector('#regAuto').innerHTML=birth.value?`<b>Umur:</b> ${age} tahun &nbsp; <b>Kelompok usia:</b> ${group}`:'Umur dan kelompok usia muncul otomatis setelah tanggal lahir dipilih.'
  })
  document.querySelector('#checkRegistrationStatus')?.addEventListener('click',()=>{
    const code=String(document.querySelector('#registrationCodeInput')?.value||'').trim().toUpperCase()
    const result=document.querySelector('#registrationStatusResult')
    const reg=(state.pendingRegistrations||[]).find(r=>String(r.id).toUpperCase()===code)
    if(!result)return
    if(!reg){result.innerHTML='<span class="error">Kode pendaftaran tidak ditemukan.</span>';return}
    const note=reg.adminNote?`<br><b>Keterangan Admin:</b> ${esc(reg.adminNote)}`:''
    const athlete=reg.athleteId?`<br><b>ID Atlet:</b> ${esc(reg.athleteId)}`:''
    result.innerHTML=`<b>${esc(reg.name)}</b><br>Status: <span class="status status-${esc(reg.status)}">${registrationStatusLabel(reg.status)}</span>${athlete}${note}`
  })
  document.querySelector('#registerForm')?.addEventListener('submit',async e=>{
    e.preventDefault()
    const form=e.currentTarget,f=new FormData(form),error=document.querySelector('#registerError')
    error.textContent=''
    try{
      setFormBusy(form,true,'Mengunggah dan menyimpan...')
      const birth=String(f.get('birth'))
      const registrationId=`REG-${Date.now()}-${createId()}`
      const registration={
        id:registrationId,
        submittedAt:new Date().toISOString(),
        status:'pending',
        photo:await registrationUpload(f.get('photo'),'photo',registrationId),
        name:String(f.get('name')||'').trim(),
        gender:String(f.get('gender')||''),
        birth,
        age:calcAge(birth),
        ageGroup:calcGroup(birth),
        classCategory:String(f.get('classCategory')||''),
        healthNote:String(f.get('healthNote')||'').trim(),
        certificate:await registrationUpload(f.get('certificate'),'certificate',registrationId),
        certificateName:f.get('certificate')?.name||'',
        paymentProof:await registrationUpload(f.get('paymentProof'),'registration-proof',registrationId),
        paymentProofName:f.get('paymentProof')?.name||'',
        package:String(f.get('package')||''),
        parentWhatsapp:String(f.get('parentWhatsapp')||'').trim(),
        paymentBank:'Bank Mandiri',
        paymentAccountName:'FAHMI DJAWAS',
        paymentAccountNumber:'1560020198356'
      }
      state.pendingRegistrations.push(registration)
      addAdminNotification('registration','Pendaftar Atlet Baru',`${registration.name} mengirim formulir pendaftaran.`,'registrations')
      await commitCriticalRecord('pendingRegistrations',registration.id)
      form.reset()
      document.querySelector('#regAuto').textContent='Umur dan kelompok usia muncul otomatis setelah tanggal lahir dipilih.'

      const popup=document.createElement('div')
      popup.className='registration-success-overlay'
      popup.innerHTML=`<section class="registration-success-popup" role="dialog" aria-modal="true" aria-labelledby="registrationSuccessTitle">
        <div class="success-icon">✓</div>
        <h2 id="registrationSuccessTitle">Pendaftaran Berhasil Dikirim</h2>
        <p>Pendaftaran <b></b> sudah diterima dan sedang menunggu verifikasi admin.</p><div class="registration-code-box"><span>Kode Pendaftaran</span><strong>${registration.id}</strong><small>Simpan kode ini untuk mengecek status.</small></div>
        <p class="whatsapp-invite">Silakan bergabung ke grup WhatsApp AQILAH Swimming Club untuk memperoleh informasi latihan dan pengumuman terbaru.</p>
        <div class="registration-success-actions">
          <a class="whatsapp-join-button" href="https://chat.whatsapp.com/LcRUbzCTnqrCWrI0x4wx0P?s=sh&p=a&ilr=1&amv=1" target="_blank" rel="noopener noreferrer">Masuk Grup WhatsApp</a>
          <button type="button" class="secondary" data-close-registration-popup>Nanti Saja</button>
        </div>
      </section>`
      popup.querySelector('p b').textContent=registration.name
      document.body.appendChild(popup)
      const closeSuccessPopup=()=>{popup.remove();show('parent')}
      popup.querySelector('[data-close-registration-popup]').addEventListener('click',closeSuccessPopup)
      popup.querySelector('.whatsapp-join-button').addEventListener('click',()=>setTimeout(closeSuccessPopup,250))
      popup.addEventListener('click',event=>{if(event.target===popup)closeSuccessPopup()})
    }catch(err){error.textContent=err.message||'Pendaftaran gagal dikirim.'}
    finally{setFormBusy(form,false)}
  })
 }
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab))
 const closeLogin=()=>{document.querySelector('#authContent').innerHTML='';document.querySelectorAll('.auth-tabs button').forEach(b=>b.classList.remove('active'))}
 document.querySelector('#authContent').addEventListener('click',e=>{if(e.target.id==='authContent')closeLogin()})
}

const adminMenu=[['dashboard','Dashboard','⌂'],['notifications','Notifikasi','🔔'],['athletes','Data Atlet','♟'],['registrations','Pendaftar Baru','✚'],['coaches','Pelatih','♜'],['coachSalaries','Gaji Pelatih','Rp'],['development','Perkembangan Atlet','◆'],['attendance','Absensi','✓'],['trainingPrograms','Program Latihan','▣'],['timeRecords','Catatan Waktu','⏱'],['schedules','Jadwal Latihan','◷'],['competitions','Kompetisi / Event','★'],['competitionRegistrations','Pendaftaran Lomba','✓'],['competitionPayments','Pembayaran Lomba','Rp'],['payments','Pembayaran SPP','Rp'],['invoices','Tagihan','▦'],['announcements','Pengumuman','◖'],['reports','Laporan','▤'],['settings','Pengaturan','⚙']]
const coachMenu=[['coachDashboard','Dashboard','⌂'],['coachAthletes','Atlet Binaan','♟'],['trainingPrograms','Program Latihan','▣'],['coachAttendance','Absensi','✓'],['coachTimeRecords','Catatan Waktu','⏱'],['coachDevelopment','Evaluasi Atlet','◆'],['coachSchedules','Jadwal Latihan','◷'],['coachAnnouncements','Pengumuman','◖'],['coachNotifications','Notifikasi','🔔'],['coachSalaryHistory','Riwayat Gaji','Rp'],['coachSettings','Pengaturan','⚙']]
const parentMenu=[['parentDashboard','Dashboard','⌂'],['parentProfile','Profil Anak','♟'],['parentAttendance','Kehadiran','◔'],['parentJournal','Nilai & Evaluasi','✓'],['parentPrograms','Program Latihan','▣'],['parentCompetitions','Daftar Perlombaan','★'],['parentSchedules','Jadwal','◷'],['parentInvoices','Tagihan','▦'],['parentPayment','Pembayaran','Rp'],['parentAnnouncements','Pengumuman','◖'],['parentSettings','Pengaturan','⚙']]
function dashboardCredit(){return `<footer class="dashboard-credit">Dashboard didesain oleh <strong>FAHMI DJAWAS</strong>. © 2026 Semua hak dilindungi</footer>`}
function shell(content){
 const menus=role==='admin'?adminMenu:role==='coach'?coachMenu:parentMenu
 const unread=role==='admin'?unreadNotifications():0
 const primaryIds=role==='admin'?['dashboard','athletes','attendance','trainingPrograms']:
   role==='coach'?['coachDashboard','coachAthletes','trainingPrograms','coachAttendance']:
   ['parentDashboard','parentProfile','parentPrograms','parentPayment']
 const primaryMenus=primaryIds.map(id=>menus.find(x=>x[0]===id)).filter(Boolean)
 const pageTitle=menus.find(x=>x[0]===currentPage)?.[1]||''
 const isPrimary=primaryIds.includes(currentPage)
 return `<div class="app-shell app-enter role-${role}">
  <aside class="sidebar" aria-label="Menu lengkap"><div class="logo-box">${clubLogo("sidebar-logo")}<span>${esc(state.settings.clubName||"AQILAH Swimming Club")}</span></div><nav>${menus.map(([id,l,i])=>`<button class="nav-item ${currentPage===id?'active':''} ${/settings/i.test(id)?'nav-settings':''}" data-page="${id}"><i>${i}</i><span>${l}</span>${id==='notifications'&&unread?`<em class="menu-badge">${unread}</em>`:''}</button>`).join('')}</nav><button id="logoutBtn" class="nav-item logout"><i>↪</i><span>Keluar</span></button></aside>
  <button type="button" class="sidebar-backdrop" aria-label="Tutup menu navigasi"></button>
  <section class="main-area"><header class="topbar"><button id="menuBtn" class="menu-btn" aria-label="Buka menu lengkap">☰</button><div class="topbar-title"><h2>${esc(pageTitle)}</h2><small>${new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</small></div>${role==='admin'?`<button class="notification-bell" data-page="notifications" aria-label="Notifikasi">🔔${unread?`<b>${unread}</b>`:''}</button>`:''}<span id="syncBadge" class="sync-badge">${esc(syncStatus)}</span></header><main class="content blue-dashboard-content">${content}${dashboardCredit()}</main></section>
  <nav class="bottom-nav" aria-label="Navigasi utama">${primaryMenus.map(([id,l,i])=>`<button class="bottom-nav-item ${currentPage===id?'active':''}" data-page="${id}"><i>${i}</i><span>${l.replace('Program Latihan','Program').replace('Pembayaran','Bayar').replace('Data Atlet','Atlet').replace('Atlet Binaan','Atlet').replace('Profil Anak','Profil').replace('Absensi','Hadir')}</span></button>`).join('')}<button id="moreNavBtn" class="bottom-nav-item ${isPrimary?'':'active'}"><i>☰</i><span>Lainnya</span></button></nav>
 </div>`
}
function pieChart(data,title){const total=data.reduce((s,x)=>s+x.value,0)||1;let p=0;const colors=['#0b7bd8','#19b36b','#ff9d16','#7656d6','#e34f67','#13a6b8'];const stops=data.map((x,i)=>{const a=p/total*360;p+=x.value;const b=p/total*360;return `${colors[i%colors.length]} ${a}deg ${b}deg`}).join(',');return `<div class="pie-card"><h3>${title}</h3><div class="pie-wrap"><div class="pie" style="background:conic-gradient(${stops})"><span>${total}</span></div><div class="pie-legend">${data.map((x,i)=>`<div><i style="background:${colors[i%colors.length]}"></i><span>${esc(x.label)}</span><b>${x.value}</b></div>`).join('')}</div></div></div>`}

function todayIso(){return new Date().toISOString().slice(0,10)}
function todayAttendance(){
 const today=todayIso()
 return state.attendance.filter(r=>r.date===today)
}
function upcomingCompetitions(){
 const today=todayIso()
 return state.competitions.filter(e=>!e.eventDate||e.eventDate>=today).slice().sort((a,b)=>String(a.eventDate||'').localeCompare(String(b.eventDate||'')))
}
function currentDayName(){return new Date().toLocaleDateString('id-ID',{weekday:'long'})}
function categoryStats(){
 return ['Pemula','Junior','Prestasi'].map(label=>({label,value:state.athletes.filter(a=>(a.trainingCategory||'Pemula')===label).length}))
}
function attendanceBars(){
 const rows=[]
 for(let i=6;i>=0;i--){
   const d=new Date();d.setDate(d.getDate()-i)
   const iso=d.toISOString().slice(0,10)
   const total=state.attendance.filter(r=>r.date===iso).length
   const hadir=state.attendance.filter(r=>r.date===iso&&r.status==='Hadir').length
   rows.push({label:d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}),value:total?Math.round(hadir/total*100):0})
 }
 return rows
}
function miniBarChart(rows){
 return `<div class="mini-chart">${rows.map(r=>`<div class="bar-col"><span>${r.value}%</span><i style="height:${Math.max(8,r.value)}%"></i><small>${esc(r.label)}</small></div>`).join('')}</div>`
}
function dashboardScheduleRows(limit=4){
 const day=currentDayName()
 const rows=state.schedules.filter(s=>s.day===day).slice(0,limit)
 return rows.length?rows.map(r=>`<div class="dashboard-list-row"><b>${esc(r.time||'-')}</b><span>${esc(r.group||'Semua Kelompok')}</span><em>${esc(r.location||'-')}</em></div>`).join(''):'<div class="empty compact-empty">Belum ada jadwal hari ini.</div>'
}
function announcementRows(limit=4){
 const rows=(state.announcements||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,limit)
 return rows.length?rows.map(a=>`<div class="announcement-line"><i>◖</i><div><b>${esc(a.title)}</b><small>${esc(a.date||'')}</small></div></div>`).join(''):'<div class="empty compact-empty">Belum ada pengumuman.</div>'
}
function dashboardPage(){
 const todayRows=todayAttendance(),hadir=todayRows.filter(r=>r.status==='Hadir').length
 const attendancePct=todayRows.length?Math.round(hadir/todayRows.length*100):0
 const events=upcomingCompetitions()
 const latestProgram=state.trainingPrograms.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]
 const latestEvent=events[0]
 return `<div class="dashboard-heading"><div><p>Dashboard Admin</p><h1>Selamat datang, ${esc(state.settings.coachName||'Admin ASC')}</h1></div><span>${new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</span></div>
 <div class="dashboard-kpis">
  <article class="kpi-card"><i>♟</i><div><span>Total Atlet</span><b>${state.athletes.length}</b><small>Atlet terdaftar</small></div></article>
  <article class="kpi-card green"><i>✓</i><div><span>Hadir Hari Ini</span><b>${hadir}</b><small>${attendancePct}% kehadiran</small></div></article>
  <article class="kpi-card purple"><i>▣</i><div><span>Program Aktif</span><b>${state.trainingPrograms.length}</b><small>Program latihan</small></div></article>
  <article class="kpi-card orange"><i>◷</i><div><span>Event Mendatang</span><b>${events.length}</b><small>Event perlombaan</small></div></article>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Grafik Kehadiran (7 Hari Terakhir)</h3></div>${miniBarChart(attendanceBars())}</section>
  ${pieChart(categoryStats(),'Atlet per Kategori')}
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Jadwal Hari Ini</h3><button data-page="schedules">Lihat Semua</button></div>${dashboardScheduleRows()}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Pengumuman Terbaru</h3><button data-page="announcements">Lihat Semua</button></div>${announcementRows()}</section>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Program Terbaru</h3><button data-page="trainingPrograms">Lihat Semua</button></div>${latestProgram?`<div class="featured-program"><i>▤</i><div><b>${esc(latestProgram.title)}</b><small>${esc((latestProgram.categories||[]).join(', ')||'Semua Atlet')} · ${esc(latestProgram.date||'')}</small></div></div>`:'<div class="empty compact-empty">Belum ada program latihan.</div>'}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Event Mendatang</h3><button data-page="competitions">Lihat Semua</button></div>${latestEvent?`<div class="featured-event">${latestEvent.flyer?`<img src="${latestEvent.flyer}" alt="Flyer event">`:'<div class="event-placeholder">★</div>'}<div><b>${esc(latestEvent.title)}</b><small>${esc(latestEvent.eventDate||'-')}</small><span>${esc(latestEvent.location||'-')}</span></div></div>`:'<div class="empty compact-empty">Belum ada event mendatang.</div>'}</section>
 </div>`
}

function schedulesManagementPage(){
 const rows=state.schedules.slice().sort((a,b)=>String(a.day||'').localeCompare(String(b.day||''))||String(a.time||'').localeCompare(String(b.time||'')))
 const canManage=['admin','coach'].includes(role)
 return `${canManage?`<section class="card">
 <div class="card-head"><div><h3>Input Jadwal Latihan</h3><p class="hint">Jadwal dapat dikelola oleh Admin dan Pelatih.</p></div></div>
 <form id="trainingScheduleForm" class="form-grid">
 <label>Hari<select name="day" required><option>Senin</option><option>Selasa</option><option>Rabu</option><option>Kamis</option><option>Jumat</option><option>Sabtu</option><option>Minggu</option></select></label>
 <label>Jam<input name="time" type="time" required></label>
 <label>Lokasi<input name="location" required placeholder="Nama kolam renang"></label>
 <label>Kelompok/Kelas<input name="group" required placeholder="Contoh: Prestasi, Pemula, KU 3"></label>
 <label>Pelatih<select name="coachId"><option value="">Semua Pelatih</option>${state.coaches.filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
 <button class="primary">Simpan Jadwal</button>
 </form></section>`:''}
 <section class="card"><div class="card-head"><div><h3>Jadwal Latihan</h3>${role==='parent'?'<small>Jadwal ditampilkan sesuai data yang telah diisi Admin. Orang tua hanya dapat melihat.</small>':''}</div></div>${rows.length?rows.map(r=>{const c=state.coaches.find(x=>x.id===r.coachId);return `<div class="list-row"><div><b>${esc(r.day)} · ${esc(r.time)}</b><span>${esc(r.location)} · ${esc(r.group)}${c?` · ${esc(c.name)}`:''}</span></div>${canManage?`<button class="danger small" data-delete-schedule="${r.id}">Hapus</button>`:''}</div>`}).join(''):'<div class="empty">Belum ada jadwal latihan.</div>'}</section>`
}
function attendanceManagementPage(){
 const today=new Date().toISOString().slice(0,10)
 const selectedDate=window.__ascAttendanceDate||today
 const records=state.attendance.filter(r=>r.date===selectedDate)
 const recordMap=Object.fromEntries(records.map(r=>[r.athleteId,r]))
 return `<section class="card"><div class="card-head"><div><h3>Absensi Atlet</h3><small>Catat kehadiran latihan berdasarkan tanggal.</small></div></div>
 <div class="attendance-toolbar"><label>Tanggal Absensi<input id="attendanceDate" type="date" value="${selectedDate}"></label><span class="notice compact">Perubahan langsung tersimpan.</span></div>
 <div class="table-wrap"><table><thead><tr><th>ID Atlet</th><th>Nama Atlet</th><th>KU</th><th>Status Kehadiran</th><th>Keterangan</th></tr></thead><tbody>
 ${state.athletes.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(a=>{const r=recordMap[a.id]||{};return `<tr><td><b>${esc(a.id)}</b></td><td>${esc(a.name)}</td><td>${esc(a.ageGroup||calcGroup(a.birth))}</td><td><select class="attendance-status" data-athlete-id="${esc(a.id)}"><option value="">Belum Diisi</option>${['Hadir','Izin','Sakit','Alpa'].map(x=>`<option ${r.status===x?'selected':''}>${x}</option>`).join('')}</select></td><td><input class="attendance-note" data-athlete-id="${esc(a.id)}" value="${esc(r.note||'')}" placeholder="Opsional"></td></tr>`}).join('')}
 </tbody></table></div></section>`
}

function timeToCentiseconds(value){
 const m=String(value||'').trim().replace(':','.').split('.').map(Number)
 if(m.length!==3||m.some(Number.isNaN))return null
 return (m[0]*60+m[1])*100+m[2]
}
function timeFromCentiseconds(value){
 const total=Math.max(0,Number(value)||0),minutes=Math.floor(total/6000),seconds=Math.floor((total%6000)/100),centis=total%100
 return `${String(minutes).padStart(2,'0')}.${String(seconds).padStart(2,'0')}.${String(centis).padStart(2,'0')}`
}
function progressBars(records){
 const rows=(Array.isArray(records)?records:[]).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).slice(-8)
 if(!rows.length)return '<div class="empty compact-empty">Belum ada data untuk grafik perkembangan.</div>'
 const vals=rows.map(r=>timeToCentiseconds(r.time)).filter(v=>v!==null)
 if(!vals.length)return '<div class="empty compact-empty">Format waktu belum dapat dihitung.</div>'
 const max=Math.max(...vals),min=Math.min(...vals),range=Math.max(1,max-min)
 return `<div class="time-progress-chart">${rows.map((r,i)=>{const v=timeToCentiseconds(r.time);const pct=v===null?20:Math.max(18,100-((v-min)/range)*72);return `<div class="time-progress-item" title="${esc(r.date)} — ${esc(r.time)}"><span class="time-progress-value">${esc(r.time)}</span><div class="time-progress-track"><i style="height:${pct}%"></i></div><small>${esc((r.date||'').slice(5))}</small></div>`}).join('')}</div>`
}
function personalBestSummary(records){
 const grouped={}
 ;(records||[]).forEach(r=>{const key=`${r.stroke||'-'}|${r.distance||0}`;const v=timeToCentiseconds(r.time);if(v===null)return;if(!grouped[key]||v<grouped[key].value)grouped[key]={...r,value:v}})
 const best=Object.values(grouped).sort((a,b)=>a.value-b.value).slice(0,6)
 return best.length?`<div class="pb-grid">${best.map(r=>`<article class="pb-card"><span>${esc(r.stroke)} · ${Number(r.distance||0)}m</span><b>${esc(r.time)}</b><small>PB · ${esc(r.date||'-')}</small></article>`).join('')}</div>`:'<div class="empty compact-empty">Belum ada personal best.</div>'
}

function timeRecordsPage(){
 const rows=state.timeRecords.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
 const strokes=['Gaya Bebas','Gaya Dada','Gaya Punggung','Gaya Kupu-kupu','Gaya Ganti Perorangan (IM)','Gaya Bebas Fins','Gaya Kupu-kupu Fins','Gaya Punggung Fins']
 const distances=[25,50,100,200,400,800,1500]
 const selectedId=window.__ascTimeAthlete||''
 const selectedRecords=selectedId?rows.filter(r=>r.athleteId===selectedId):rows
 return `<section class="card"><div class="card-head"><div><h3>Catatan Waktu Atlet</h3><small>Rekam, edit, dan pantau perkembangan waktu latihan atau kejuaraan.</small></div><button class="primary small" id="addTime">+ Tambah Catatan Waktu</button></div>
 <div class="record-toolbar"><label>Pilih Atlet untuk Grafik${athleteCombobox('timeAthleteFilter',selectedId,'timeAthleteFilter')}</label></div>
 <section class="record-insight-grid"><article class="insight-card"><h4>Grafik Perkembangan Waktu</h4>${progressBars(selectedRecords)}</article><article class="insight-card"><h4>Personal Best</h4>${personalBestSummary(selectedRecords)}</article></section>
 <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Atlet</th><th>Gaya Renang</th><th>Jarak</th><th>Jenis</th><th>Tingkat</th><th>Waktu</th><th>Pelatih</th><th>Aksi</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${esc(r.date||'-')}</td><td><b>${esc(r.athleteName||r.athleteId)}</b></td><td>${esc(r.stroke||'-')}</td><td>${esc(r.distance?`${r.distance} m`:'-')}</td><td>${esc(r.type||'-')}</td><td>${esc(r.level||'-')}</td><td><strong>${esc(r.time||'-')}</strong></td><td>${esc(r.coachName||'-')}</td><td><div class="table-actions"><button class="secondary tiny" data-edit-time="${r.id}">Edit</button><button class="danger tiny" data-delete-time="${r.id}">Hapus</button></div></td></tr>`).join(''):'<tr><td colspan="9" class="empty">Belum ada catatan waktu.</td></tr>'}</tbody></table></div></section>
 <dialog id="timeDialog"><form id="timeForm" class="modal-form"><input type="hidden" name="editId"><div class="card-head"><h3 id="timeDialogTitle">Tambah Catatan Waktu</h3><button type="button" class="icon-btn" data-close>✕</button></div>
 <label>Atlet${athleteCombobox('athleteId','','timeRecordAthlete')}</label>
 <label>Tanggal<input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
 <label>Gaya Renang<select name="stroke" required>${strokes.map(x=>`<option>${x}</option>`).join('')}</select></label>
 <label>Jarak<select name="distance" required>${distances.map(x=>`<option value="${x}">${x} meter</option>`).join('')}</select></label>
 <label>Jenis<select id="recordType" name="type"><option>Latihan</option><option>Kejuaraan</option></select></label>
 <label id="levelField" class="hidden">Tingkat Kejuaraan<input name="level" placeholder="Kabupaten/Provinsi/Nasional"></label>
 <label>Waktu (MM:SS.CC atau MM.SS.CC)<input name="time" inputmode="decimal" required placeholder="01:25.48"></label>
 <button class="primary">Simpan Catatan Waktu</button></form></dialog>`
}


function programCards(programs){
 const rows=Array.isArray(programs)?programs:[]
 if(!rows.length)return '<div class="empty">Belum ada program latihan.</div>'
 return `<div class="program-grid">${rows.map(p=>{
  const groups=(p.trainingGroups||[]).join(', ')
  const categories=(p.categories||[]).join(', ')||'Semua Atlet'
  const canManage=['admin','coach'].includes(role)
  const youtube=p.videoUrl?`<a class="secondary small inline-button" href="${esc(p.videoUrl)}" target="_blank" rel="noopener">Buka Video</a>`:''
  return `<article class="program-card">${p.image?`<img class="program-image" src="${p.image}" alt="Program ${esc(p.title||'Latihan')}">`:'<div class="program-image-placeholder">▣</div>'}<div class="program-card-body"><span class="status status-approved">${esc(p.date||'-')}</span><h3>${esc(p.title||'Program Latihan')}</h3><p><b>Kategori:</b> ${esc(categories)}</p>${groups?`<p><b>Kelompok/KU:</b> ${esc(groups)}</p>`:''}<p><b>Durasi:</b> ${esc(p.duration||'-')} &nbsp; <b>Total:</b> ${Number(p.totalMeters||0).toLocaleString('id-ID')} m</p>${p.details?`<div class="program-details">${esc(p.details).replace(/\n/g,'<br>')}</div>`:''}<div class="dialog-actions">${youtube}${canManage?`<button class="secondary small" data-edit-program="${p.id}">Edit</button><button class="danger small" data-delete-program="${p.id}">Hapus</button>`:''}</div></div></article>`
 }).join('')}</div>`
}

function trainingProgramsPage(){
 return `<section class="card"><div class="card-head"><h3>Program Latihan</h3><button class="primary small" id="addProgram">+ Upload Program</button></div>${programCards(state.trainingPrograms.slice().reverse())}</section>
 <dialog id="programDialog"><form id="programForm" class="modal-form"><input type="hidden" name="editId">
 <div class="card-head"><h3 id="programDialogTitle">Upload Program Latihan</h3><button type="button" class="icon-btn" data-close>✕</button></div>
 <label>Kategori Atlet<div class="check-group">
   <label class="check-pill"><input type="checkbox" name="categories" value="Pemula"><span>Pemula</span></label>
   <label class="check-pill"><input type="checkbox" name="categories" value="Junior"><span>Junior</span></label>
   <label class="check-pill"><input type="checkbox" name="categories" value="Prestasi"><span>Prestasi</span></label>
   <label class="check-pill"><input type="checkbox" name="categories" value="Semua Atlet"><span>Semua Atlet</span></label>
 </div></label>
 <label>Pilih Satu atau Lebih KU<div class="check-group">${trainingGroupCheckboxes([])}</div></label>
 <label>Judul Program<input name="title" required></label>
 <label>Tanggal<input name="date" type="date" required></label>
 <label>Durasi<input name="duration" placeholder="Contoh: 90 menit"></label>
 <label>Total Meter<input name="totalMeters" type="number" min="0" placeholder="Contoh: 2000"></label>
 <label>Detail Latihan<textarea name="details" rows="6" placeholder="Tulis isi program latihan"></textarea></label>
 <label>Foto/Lampiran Program<input name="image" type="file" accept="image/*"></label>
 <label>Video YouTube<input name="videoUrl" type="url" placeholder="Opsional"></label>
 <button class="primary">Simpan Program</button>
 </form></dialog>`
}

function competitionStatus(event){
 const today=new Date().toISOString().slice(0,10)
 if(event.registrationDeadline && event.registrationDeadline<today)return 'Pendaftaran Ditutup'
 if(event.eventDate && event.eventDate<today)return 'Selesai'
 return 'Pendaftaran Dibuka'
}
const competitionDistances=[25,50,100]
const competitionStrokes=[...new Set(strokes)]
function automaticCompetitionRaces(){return competitionDistances.flatMap(distance=>competitionStrokes.map(stroke=>`${distance}m ${stroke}`))}
function competitionRaceOptions(){return automaticCompetitionRaces()}
function competitionsPage(){
 const rows=state.competitions.slice().sort((a,b)=>String(b.eventDate||'').localeCompare(String(a.eventDate||'')))
 return `<section class="card">
 <div class="card-head"><div><h3>Event Perlombaan</h3><p class="hint">Buat event, biaya, dan nomor lomba yang dapat dipilih orang tua.</p></div><button class="primary small" id="addCompetition">+ Tambah Event</button></div>
 <div class="competition-grid">${rows.length?rows.map(e=>`<article class="competition-card">${e.flyer?`<img class="competition-flyer" src="${e.flyer}" alt="Flyer ${esc(e.title)}">`:'<div class="competition-flyer-placeholder">🏆</div>'}<div class="competition-card-body"><span class="competition-status">${esc(competitionStatus(e))}</span><h3>${esc(e.title)}</h3><p><b>Tanggal:</b> ${esc(e.eventDate||'-')}</p><p><b>Lokasi:</b> ${esc(e.location||'-')}</p><p><b>Batas Pendaftaran:</b> ${esc(e.registrationDeadline||'-')}</p><p><b>Biaya per nomor:</b> Rp${Number(e.feePerRace||0).toLocaleString('id-ID')}</p><p><b>Nomor tersedia:</b> ${competitionRaceOptions().length} nomor otomatis — jarak 25m, 50m, dan 100m untuk seluruh gaya renang.</p>${e.description?`<p>${esc(e.description)}</p>`:''}<button class="danger small" data-delete-competition="${e.id}">Hapus Event</button></div></article>`).join(''):'<div class="empty">Belum ada event perlombaan.</div>'}</div></section>
 <dialog id="competitionDialog"><form id="competitionForm" class="modal-form"><div class="card-head"><h3>Tambah Event Perlombaan</h3><button type="button" class="icon-btn" data-close>✕</button></div>
 <label>Nama Perlombaan<input name="title" required></label><label>Penyelenggara<input name="organizer" required></label><label>Tanggal Perlombaan<input name="eventDate" type="date" required></label><label>Lokasi<input name="location" required></label><label>Batas Pendaftaran<input name="registrationDeadline" type="date" required></label><label>Biaya per Nomor<input name="feePerRace" type="number" min="0" required></label><div class="notice compact"><b>Nomor lomba dibuat otomatis</b><br>Seluruh gaya renang tersedia untuk jarak 25m, 50m, dan 100m.</div><label>Flyer Perlombaan<input name="flyer" type="file" accept="image/*"></label><label>Keterangan<textarea name="description" rows="3"></textarea></label><button class="primary">Simpan dan Tampilkan</button></form></dialog>`
}
function competitionRegistrationStatusLabel(status){return status==='registered'?'Terdaftar':status==='rejected'?'Ditolak':status==='submitted'?'Menunggu Verifikasi':'Draft'}
function parentCompetitionsPage(){
 const a=parentAthlete(),rows=state.competitions.slice().sort((x,y)=>String(y.eventDate||'').localeCompare(String(x.eventDate||''))),mine=state.competitionRegistrations.filter(r=>r.athleteId===a?.id).slice().reverse()
 return `<section class="card"><div class="card-head"><div><h3>Daftar Lomba</h3><p class="hint">Pendaftaran hanya dikirim ke Admin setelah bukti pembayaran diunggah.</p></div></div>
 <div class="competition-grid parent-competition-grid">${rows.length?rows.map(e=>{const draft=mine.find(r=>r.competitionId===e.id&&r.status==='draft'),active=mine.find(r=>r.competitionId===e.id&&['submitted','registered'].includes(r.status));return `<article class="competition-card">${e.flyer?`<button class="flyer-button" data-view-flyer="${e.id}"><img class="competition-flyer" src="${e.flyer}" alt="Flyer ${esc(e.title)}"></button>`:'<div class="competition-flyer-placeholder">🏆</div>'}<div class="competition-card-body"><span class="competition-status">${esc(competitionStatus(e))}</span><h3>${esc(e.title)}</h3><p><b>Tanggal:</b> ${esc(e.eventDate||'-')}</p><p><b>Lokasi:</b> ${esc(e.location||'-')}</p><p><b>Biaya per nomor:</b> Rp${Number(e.feePerRace||0).toLocaleString('id-ID')}</p><p><b>Nomor:</b> Jarak 25m, 50m, dan 100m untuk seluruh gaya renang.</p>${active?`<span class="status status-${active.status==='registered'?'approved':'pending'}">${competitionRegistrationStatusLabel(active.status)}</span>`:competitionStatus(e)==='Pendaftaran Dibuka'?`<button class="primary small" data-register-competition="${e.id}">${draft?'Lanjutkan Draft':'Daftar Sekarang'}</button>`:''}</div></article>`}).join(''):'<div class="empty">Belum ada event perlombaan.</div>'}</div></section>
 <section class="card"><h3>Riwayat Pendaftaran Lomba</h3><div class="table-wrap"><table><thead><tr><th>Event</th><th>Nomor Lomba</th><th>Total</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>${mine.length?mine.map(r=>`<tr><td><b>${esc(r.competitionTitle)}</b></td><td>${esc((r.races||[]).join(', '))}</td><td>Rp${Number(r.amount||0).toLocaleString('id-ID')}</td><td><span class="status status-${r.status==='registered'?'approved':r.status==='rejected'?'rejected':'pending'}">${competitionRegistrationStatusLabel(r.status)}</span></td><td>${esc(r.adminNote||'-')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Belum ada pendaftaran.</td></tr>'}</tbody></table></div></section>
 <dialog id="competitionRegistrationDialog"><form id="competitionRegistrationForm" class="modal-form"><input type="hidden" name="competitionId"><div class="card-head"><h3 id="competitionRegistrationTitle">Daftar Lomba</h3><button type="button" class="icon-btn" data-close>✕</button></div><div id="competitionRaceChoices" class="check-group"></div><div class="bank-payment-info"><span>TRANSFER PEMBAYARAN LOMBA KE</span><b>BANK MANDIRI</b><small>NOMOR REKENING</small><strong class="bank-account-number">1560020198356</strong><small>ATAS NAMA</small><b>FAHMI DJAWAS</b><p class="bank-warning">Pastikan nomor rekening dan nama penerima sudah benar sebelum mengirim pembayaran.</p></div><div id="competitionTotal" class="notice compact">Total: Rp0</div><label>Bukti Pembayaran<input name="proof" type="file" accept="image/*,application/pdf"></label><label>Catatan Orang Tua<input name="parentNote" placeholder="Opsional"></label><div class="dialog-actions"><button type="submit" name="action" value="draft" class="secondary">Simpan Draft</button><button type="submit" name="action" value="submit" class="primary">Kirim Pendaftaran & Pembayaran</button></div><p class="hint">Tanpa bukti pembayaran, data hanya tersimpan sebagai Draft dan tidak tampil di Admin.</p></form></dialog>
 <dialog id="flyerPreviewDialog" class="flyer-preview-dialog"><button type="button" class="icon-btn flyer-close" data-close>✕</button><img id="flyerPreviewImage" alt="Flyer perlombaan"></dialog>`
}
function competitionRegistrationsPage(){
 const rows=state.competitionRegistrations.filter(r=>r.status!=='draft').slice().reverse()
 return `<section class="card"><div class="card-head"><div><h3>Pendaftaran Lomba</h3><small>Download data peserta dalam Excel. Setiap nomor lomba ditempatkan pada kolom tersendiri.</small></div><button class="primary small" id="downloadCompetitionExcel">⬇ Download Excel</button></div><div class="table-wrap"><table><thead><tr><th>Atlet</th><th>Event</th><th>Nomor Lomba</th><th>Total</th><th>Status</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><b>${esc(r.athleteName)}</b><small class="cell-sub">${esc(r.athleteId)}</small></td><td>${esc(r.competitionTitle)}</td><td>${esc((r.races||[]).join(', '))}</td><td>Rp${Number(r.amount||0).toLocaleString('id-ID')}</td><td>${competitionRegistrationStatusLabel(r.status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Belum ada pendaftaran yang dikirim.</td></tr>'}</tbody></table></div></section>`
}
function competitionPaymentsPage(){
 const rows=state.competitionRegistrations.filter(r=>r.status!=='draft'&&!r.paymentPurgedAt).slice().reverse()
 return `<section class="card"><div class="card-head"><div><h3>Pembayaran Lomba</h3><small>Preview bukti pembayaran terlebih dahulu sebelum diunduh.</small></div></div><div class="table-wrap"><table><thead><tr><th>Atlet</th><th>Event / Nomor</th><th>Nominal</th><th>Bukti</th><th>Tanggal</th><th>Status</th><th>Keterangan</th><th>Aksi</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><b>${esc(r.athleteName)}</b></td><td>${esc(r.competitionTitle)}<small class="cell-sub">${esc((r.races||[]).join(', '))}</small></td><td>Rp${Number(r.amount||0).toLocaleString('id-ID')}</td><td>${r.proof?`<button class="secondary tiny" data-preview-competition-proof="${r.id}">Preview Bukti</button>`:'-'}</td><td>${new Date(r.submittedAt||Date.now()).toLocaleString('id-ID')}</td><td>${competitionRegistrationStatusLabel(r.status)}</td><td>${esc(r.adminNote||'-')}</td><td>${r.status==='submitted'?`<div class="action-stack"><button class="primary tiny" data-approve-competition-registration="${r.id}">Terima</button><button class="danger tiny" data-reject-competition-registration="${r.id}">Tolak</button></div>`:'-'}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">Belum ada pembayaran lomba.</td></tr>'}</tbody></table></div><dialog id="competitionProofPreviewDialog" class="document-preview-dialog"><div class="modal-form document-preview-shell"><div class="card-head"><div><h3>Preview Bukti Pembayaran Lomba</h3><small id="competitionProofPreviewMeta"></small></div><button type="button" class="icon-btn" data-close>✕</button></div><div class="document-preview-content" id="competitionProofPreviewContent"></div><a id="competitionProofDownloadLink" class="primary inline-button" download="bukti-pembayaran-lomba">Download Bukti</a></div></dialog></section>`
}

function generic(title,rows=[]){return `<section class="card"><h3>${title}</h3>${rows.length?rows.map(x=>`<div class="list-row">${esc(JSON.stringify(x))}</div>`).join(''):'<div class="empty">Belum ada data.</div>'}</section>`}
function parentAthlete(){return state.athletes.find(a=>a.id===parentAthleteId)}

function latestForAthlete(list, athleteId){return list.filter(x=>x.athleteId===athleteId).slice().sort((a,b)=>String(b.updatedAt||b.date||'').localeCompare(String(a.updatedAt||a.date||'')))[0]}
function targetStatusClass(status){return status==='Tercapai'?'approved':status==='Perlu Diulang'?'rejected':'pending'}
function attendanceStats(athleteId){
 const now=new Date(),month=now.getMonth(),year=now.getFullYear()
 const rows=state.attendance.filter(r=>r.athleteId===athleteId&&(()=>{const d=new Date(`${r.date||''}T00:00:00`);return !Number.isNaN(d)&&d.getMonth()===month&&d.getFullYear()===year})())
 const present=rows.filter(r=>r.status==='Hadir').length
 const absent=rows.length-present
 return {rows,present,absent,total:rows.length,percentage:rows.length?Math.round(present/rows.length*100):0}
}
function parentTargetPage(){
 const a=parentAthlete(),target=latestForAthlete(state.weeklyTargets,a.id)
 return `<div class="welcome-card photo-hero"><div><p>Fokus utama minggu ini</p><h1>Target & Capaian</h1><span>${esc(a.name)}</span></div><div class="swimmer">🎯</div></div>
 <section class="card focus-card">${target?`<div class="target-top"><div><small>Misi Hari Ini</small><h2>${esc(target.mission)}</h2></div><span class="status status-${targetStatusClass(target.status)}">${esc(target.status)}</span></div><p>${esc(target.note||'')}</p><small>Diperbarui ${new Date(target.updatedAt).toLocaleDateString('id-ID')} oleh ${esc(target.coachName||'Pelatih')}</small>`:'<div class="empty">Target minggu ini belum ditentukan oleh pelatih.</div>'}</section>`
}
function parentJournalPage(){
 const a=parentAthlete(),j=latestForAthlete(state.skillJournals,a.id)
 const basic=j?.basicSkills||[]
 const styles=j?.strokeMastery||{}
 return `<section class="card"><h3>Jurnal Perkembangan Gaya</h3>${j?`
 <h4>Ceklis Kemampuan Dasar</h4><div class="skill-checks">${basic.map(x=>`<div><span>${x.done?'✅':'❌'}</span><b>${esc(x.name)}</b></div>`).join('')}</div>
 <h4>Gaya yang Dikuasai</h4><div class="mastery-grid">${Object.entries(styles).map(([k,v])=>`<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>
 <div class="coach-note"><b>Catatan Koreksi Pelatih</b><p>${esc(j.coachNote||'Belum ada koreksi.')}</p><small>${esc(j.coachName||'Pelatih')} · ${new Date(j.updatedAt).toLocaleDateString('id-ID')}</small></div>`:'<div class="empty">Jurnal perkembangan belum diisi.</div>'}</section>`
}
function parentAttendancePage(){
 const a=parentAthlete(),s=attendanceStats(a.id),warning=s.total&&s.percentage<75
 return `<div class="grid-2">${pieChart([{label:'Hadir',value:s.present},{label:'Tidak Hadir',value:s.absent}],'Kehadiran Bulan Ini')}
 <section class="card"><h3>Presensi & Komitmen</h3><div class="attendance-number"><b>${s.percentage}%</b><span>Kehadiran bulan ini</span></div>${warning?'<div class="warning-box">Kehadiran di bawah 75%. Progres anak berisiko melambat karena sesi latihan yang terlewat.</div>':'<div class="notice">Pertahankan komitmen hadir agar perkembangan tetap konsisten.</div>'}
 <button class="primary" id="openReschedule">Ajukan Jadwal Pengganti</button></section></div>
 <section class="card"><h3>Riwayat Permintaan Jadwal Pengganti</h3>${state.rescheduleRequests.filter(r=>r.athleteId===a.id).slice().reverse().map(r=>`<div class="list-row"><div><b>${esc(r.reason)}</b><small>${esc(r.preferredDate||'Tanggal fleksibel')} · ${esc(r.note||'')}</small></div><span>${esc(r.status)}</span></div>`).join('')||'<div class="empty">Belum ada permintaan.</div>'}</section>
 <dialog id="rescheduleDialog"><form id="rescheduleForm" class="modal-form"><div class="card-head"><h3>Jadwal Pengganti</h3><button type="button" data-close class="icon-btn">✕</button></div><label>Alasan<select name="reason" required><option>Sakit</option><option>Izin keluarga</option><option>Keperluan sekolah</option><option>Lainnya</option></select></label><label>Tanggal yang Diinginkan<input name="preferredDate" type="date"></label><label>Catatan<textarea name="note" rows="3"></textarea></label><button class="primary">Kirim Permintaan</button></form></dialog>`
}
function parentDrylandPage(){
 const a=parentAthlete(),tasks=state.drylandTasks.filter(t=>t.athleteId===a.id).slice().reverse()
 const enabled=!!state.parentReminders[a.id]
 return `<section class="card"><div class="card-head"><div><h3>Pratonton & Tugas di Rumah</h3><small>Dryland untuk menjaga kemampuan selama jeda latihan.</small></div><button id="toggleReminder" class="${enabled?'secondary':'primary'} small">${enabled?'Pengingat Aktif':'Aktifkan Pengingat Rabu'}</button></div>
 ${tasks.length?tasks.map(t=>`<article class="dryland-card"><div><h4>${esc(t.title)}</h4><p>${esc(t.description)}</p><small>${esc(t.duration||'±1 menit')} · ${new Date(t.date).toLocaleDateString('id-ID')}</small></div>${t.videoUrl?`<a class="primary small video-link" href="${esc(t.videoUrl)}" target="_blank">Buka Video Tutorial</a>`:''}</article>`).join(''):'<div class="empty">Belum ada tugas dryland.</div>'}</section>`
}
function parentPackagePage(){
 const a=parentAthlete(),p=latestForAthlete(state.athletePackages,a.id)
 const payments=state.payments.filter(x=>x.athleteId===a.id).slice().reverse()
 return `<div class="grid-2"><section class="card"><h3>Paket Latihan</h3>${p?`<div class="package-summary"><b>${esc(p.packageName)}</b><strong>Sisa ${esc(p.remainingSessions)} dari ${esc(p.totalSessions)} sesi</strong><span>Masa berlaku sampai ${new Date(p.expiryDate+'T00:00:00').toLocaleDateString('id-ID')}</span></div>`:'<div class="empty">Data paket belum diatur admin.</div>'}</section>
 <section class="card"><h3>Administrasi Pembayaran</h3><div class="bank-payment-info compact"><span>Rekening pembayaran SPP</span><b>Bank Mandiri</b><strong>1560020198356</strong><b>FAHMI DJAWAS</b></div>${payments.slice(0,5).map(p=>`<div class="list-row"><div><b>SPP ${esc(p.month)}</b><small>Rp${Number(p.amount||0).toLocaleString('id-ID')}</small></div><span>${paymentStatusLabel(p.status)}</span></div>`).join('')||'<div class="empty">Belum ada pembayaran.</div>'}<button class="primary small" data-page="parentPayment">Upload Bukti Pembayaran</button></section></div>`
}

function parentInvoicesPage(){
 const a=parentAthlete(),rows=state.invoices.filter(i=>i.athleteId===a.id).slice().sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt)))
 return `<section class="card"><div class="card-head"><div><h3>Tagihan Atlet</h3><small>Tagihan SPP dan lomba dari admin.</small></div></div><div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Tagihan</th><th>Nominal</th><th>Jatuh Tempo</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.length?rows.map(i=>`<tr><td>${i.type==='competition'?'Lomba':'SPP'}</td><td><b>${esc(i.title)}</b><small class="cell-sub">${esc(i.description||'')}</small></td><td>Rp${Number(i.amount).toLocaleString('id-ID')}</td><td>${i.dueDate?new Date(i.dueDate+'T00:00:00').toLocaleDateString('id-ID'):'-'}</td><td><span class="status status-${i.status==='paid'?'approved':i.status==='cancelled'?'rejected':'pending'}">${invoiceStatusLabel(i.status)}</span></td><td>${i.status==='unpaid'?`<button class="primary tiny" data-pay-invoice="${i.id}">Bayar</button>`:'-'}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Belum ada tagihan.</td></tr>'}</tbody></table></div></section>`
}
function invoicesPage(){
 const rows=state.invoices.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
 return `<section class="card"><div class="card-head"><div><h3>Tagihan Atlet</h3><small>Buat tagihan SPP atau lomba untuk orang tua.</small></div><div class="action-stack"><button class="secondary small" id="downloadInvoicesExcel">⬇ Download Excel</button><button class="primary small" id="addInvoice">+ Buat Tagihan</button></div></div><div class="table-wrap"><table><thead><tr><th>Atlet</th><th>Jenis</th><th>Judul</th><th>Nominal</th><th>Jatuh Tempo</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.length?rows.map(i=>`<tr><td>${esc(i.athleteName)}</td><td>${i.type==='competition'?'Lomba':'SPP'}</td><td><b>${esc(i.title)}</b><small class="cell-sub">${esc(i.description||'')}</small></td><td>Rp${Number(i.amount).toLocaleString('id-ID')}</td><td>${i.dueDate?new Date(i.dueDate+'T00:00:00').toLocaleDateString('id-ID'):'-'}</td><td><span class="status status-${i.status==='paid'?'approved':i.status==='cancelled'?'rejected':'pending'}">${invoiceStatusLabel(i.status)}</span></td><td><div class="action-stack">${i.status==='unpaid'?`<button class="danger tiny" data-cancel-invoice="${i.id}">Batalkan</button>`:''}<button class="danger tiny" data-delete-invoice="${i.id}">Hapus</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Belum ada tagihan.</td></tr>'}</tbody></table></div></section>
 <dialog id="invoiceDialog"><form id="invoiceForm" class="modal-form"><div class="card-head"><h3>Buat Tagihan</h3><button type="button" data-close class="icon-btn">✕</button></div><label>Atlet<select name="athleteId" required>${athleteOptions()}</select></label><label>Jenis Tagihan<select name="type"><option value="spp">SPP</option><option value="competition">Lomba</option></select></label><label>Judul<input name="title" required placeholder="SPP Agustus 2026"></label><label>Nominal<input name="amount" type="number" min="1" required></label><label>Jatuh Tempo<input name="dueDate" type="date"></label><label>Keterangan<textarea name="description" rows="3"></textarea></label><button class="primary">Simpan Tagihan</button></form></dialog>`
}

function developmentPage(){
 return `<div class="grid-2"><section class="card"><h3>Input Target Mingguan</h3><form id="targetForm" class="form-grid"><label>Atlet<select name="athleteId" required>${athleteOptions()}</select></label><label>Misi Hari Ini<input name="mission" required placeholder="Meluncur tanpa papan 5 meter"></label><label>Status<select name="status"><option>Belum Dinilai</option><option>Tercapai</option><option>Perlu Diulang</option></select></label><label>Catatan<textarea name="note" rows="3"></textarea></label><button class="primary">Simpan Target</button></form></section>
 <section class="card"><h3>Jurnal Perkembangan Gaya</h3><form id="journalForm" class="form-grid"><label>Atlet<select name="athleteId" required>${athleteOptions()}</select></label><label>Kemampuan Dasar yang Dikuasai<textarea name="skills" rows="3" placeholder="Pisahkan dengan koma: Mengapung telentang, Meluncur"></textarea></label><label>Kemampuan yang Belum Dikuasai<textarea name="notSkills" rows="3" placeholder="Berani menyelam"></textarea></label>${['Gaya Bebas','Gaya Dada','Gaya Punggung','Gaya Kupu-kupu'].map(s=>`<label>${s}<select name="${s}"><option>Belum Mulai</option><option>Sedang Belajar</option><option>Mulai Dikuasai</option><option>Dikuasai</option></select></label>`).join('')}<label>Catatan Koreksi Pelatih<textarea name="coachNote" rows="3"></textarea></label><button class="primary">Simpan Jurnal</button></form></section></div>
 <div class="grid-2"><section class="card"><h3>Tambah Tugas Dryland</h3><form id="drylandForm" class="form-grid"><label>Atlet<select name="athleteId" required>${athleteOptions()}</select></label><label>Judul<input name="title" required></label><label>Deskripsi<textarea name="description" rows="3" required></textarea></label><label>Link Video Tutorial<input name="videoUrl" type="url" placeholder="https://..."></label><label>Durasi<input name="duration" value="±1 menit"></label><button class="primary">Simpan Tugas</button></form></section>
 <section class="card"><h3>Atur Paket Atlet</h3><form id="packageForm" class="form-grid"><label>Atlet<select name="athleteId" required>${athleteOptions()}</select></label><label>Nama Paket<select name="packageName"><option>Paket 1</option><option>Paket 2</option><option>Private</option></select></label><label>Total Sesi<input name="totalSessions" type="number" min="1" required></label><label>Sisa Sesi<input name="remainingSessions" type="number" min="0" required></label><label>Masa Berlaku<input name="expiryDate" type="date" required></label><button class="primary">Simpan Paket</button></form></section></div>`
}
function parentDashboard(){
 const a=parentAthlete()
 if(!a)return `<section class="card"><h3>Dashboard Orang Tua</h3><div class="notice">Data atlet tidak ditemukan. Silakan keluar lalu login kembali menggunakan ID Atlet yang benar.</div></section>`
 const stats=attendanceStats(a.id)
 const programs=state.trainingPrograms.filter(p=>programAppliesToAthlete(p,a))
 const records=state.timeRecords.filter(r=>r.athleteId===a.id)
 const latestRecord=records.slice().sort((x,y)=>String(y.date||'').localeCompare(String(x.date||'')))[0]
 const event=upcomingCompetitions()[0]
 const invoice=state.invoices.filter(i=>i.athleteId===a.id&&i.status!=='paid')[0]
 return `<div class="parent-hero">
  <div class="parent-profile-head">${a.photo?`<img src="${a.photo}" alt="${esc(a.name)}">`:'<div class="profile-avatar">♟</div>'}<div><span>${esc(a.trainingCategory||'Pemula')}</span><h1>${esc(a.name)}</h1><p>${esc(a.id)} · ${esc((a.trainingGroups||[a.ageGroup]).join(', '))}</p></div><button data-page="parentProfile" class="primary small">Ubah Foto</button></div>
  <div class="parent-summary"><div><span>Kehadiran</span><b>${stats.percentage}%</b></div><div><span>Program Aktif</span><b>${programs.length}</b></div><div><span>Catatan Waktu</span><b>${records.length}</b></div></div>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Perkembangan Prestasi</h3><button data-page="parentTimes">Lihat Semua</button></div>${records.length?miniBarChart(records.slice(-7).map((r,i)=>({label:r.stroke.slice(0,3),value:Math.max(20,100-i*7)}))):'<div class="empty compact-empty">Belum ada catatan perkembangan.</div>'}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Nilai Evaluasi Terakhir</h3><button data-page="parentJournal">Detail</button></div><div class="evaluation-list"><div><span>Teknik</span><i style="--v:85%"></i><b>85</b></div><div><span>Endurance</span><i style="--v:80%"></i><b>80</b></div><div><span>Disiplin</span><i style="--v:90%"></i><b>90</b></div><div><span>Attitude</span><i style="--v:88%"></i><b>88</b></div></div></section>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Program Terbaru</h3><button data-page="parentPrograms">Lihat Semua</button></div>${programCards(programs.slice(-2).reverse())}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Event Perlombaan</h3><button data-page="parentCompetitions">Lihat Semua</button></div>${event?`<div class="featured-event">${event.flyer?`<img src="${event.flyer}" alt="${esc(event.title)}">`:'<div class="event-placeholder">★</div>'}<div><b>${esc(event.title)}</b><small>${esc(event.eventDate||'-')}</small><span>${esc(event.location||'-')}</span></div></div>`:'<div class="empty compact-empty">Belum ada event.</div>'}</section>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Catatan Waktu Terakhir</h3><button data-page="parentTimes">Lihat Semua</button></div>${latestRecord?`<div class="best-time"><i>⏱</i><div><span>${esc(latestRecord.stroke)}</span><b>${esc(latestRecord.time)}</b><small>${esc(latestRecord.date)}</small></div></div>`:'<div class="empty compact-empty">Belum ada catatan waktu.</div>'}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Tagihan / Pembayaran</h3><button data-page="parentInvoices">Lihat Semua</button></div>${invoice?`<div class="invoice-summary"><div><b>${esc(invoice.title)}</b><small>Jatuh tempo ${esc(invoice.dueDate||'-')}</small></div><strong>Rp${Number(invoice.amount||0).toLocaleString('id-ID')}</strong></div>`:'<div class="notice">Tidak ada tagihan yang belum dibayar.</div>'}</section>
 </div>`
}
function parentProfile(){const a=parentAthlete(),link=(url,label)=>url?`<a class="secondary small inline-button" href="${esc(url)}" target="_blank" rel="noopener">Preview ${label}</a>`:'<span>Belum diunggah</span>';return `<section class="card profile-card">${a?.photo?`<img class="profile-photo" src="${a.photo}">`:'<span class="profile-photo placeholder">👤</span>'}<div><h2>${esc(a?.name)}</h2><p><b>ID Atlet:</b> ${esc(a?.id)}</p><p><b>Tanggal lahir:</b> ${esc(a?.birth)}</p><p><b>Umur per 1 Januari 2026:</b> ${a?.age} tahun</p><p><b>Kelompok usia:</b> ${esc(a?.ageGroup)}</p><p><b>Sekolah:</b> ${esc(a?.schoolName||'-')}</p><p><b>Nomor telepon:</b> ${esc(a?.parentPhone||a?.parentWhatsapp||'-')}</p></div></section><section class="card"><h3>Perbarui Profil Atlet</h3><form id="parentProfileForm" class="form-grid"><label>Nomor Telepon<input name="parentPhone" inputmode="tel" value="${esc(a?.parentPhone||a?.parentWhatsapp||'')}"></label><label>Nama Sekolah<input name="schoolName" value="${esc(a?.schoolName||'')}"></label><label>Kartu Keluarga<input name="familyCard" type="file" accept="image/*,application/pdf"><small>${link(a?.familyCard,'Kartu Keluarga')}</small></label><label>Akta Kelahiran<input name="birthCertificate" type="file" accept="image/*,application/pdf"><small>${link(a?.birthCertificate,'Akta Kelahiran')}</small></label><label>Foto Atlet<input name="photo" type="file" accept="image/*"></label><button class="primary" type="submit">Simpan Profil</button><p id="parentProfileError" class="form-error"></p></form></section>`}
function parentPrograms(){const a=parentAthlete();return `<section class="card"><h3>Program Latihan ${esc(a?.name)}</h3>${programCards(state.trainingPrograms.filter(p=>programAppliesToAthlete(p,a)).slice().reverse())}</section>`}
function parentTimes(){const a=parentAthlete();const rows=state.timeRecords.filter(r=>r.athleteId===a?.id).sort((x,y)=>String(x.date||'').localeCompare(String(y.date||'')));return `<section class="card"><h3>Perkembangan Waktu ${esc(a?.name)}</h3><section class="record-insight-grid"><article class="insight-card"><h4>Grafik 8 Catatan Terakhir</h4>${progressBars(rows)}</article><article class="insight-card"><h4>Personal Best</h4>${personalBestSummary(rows)}</article></section><div class="table-wrap"><table><thead><tr><th>Gaya</th><th>Jenis</th><th>Tingkat</th><th>Tanggal</th><th>Waktu</th><th>Pelatih</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${r.stroke}</td><td>${r.type}</td><td>${r.level||'-'}</td><td>${r.date}</td><td><b>${r.time}</b></td><td>${esc(r.coachName||'Admin')}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">Belum ada catatan waktu.</td></tr>'}</tbody></table></div></section>`}


function notificationsPage(){const list=(state.notifications||[]).filter(n=>(n.notificationAudience||n.recipientRole||'admin')==='admin');return `<section class="card"><div class="card-head"><div><h3>Pusat Notifikasi Admin</h3><small>${unreadNotifications()} notifikasi belum dibaca</small></div><div class="notification-actions"><button class="secondary small" id="markAllRead">Tandai Semua Dibaca</button><button class="danger small" id="deleteReadNotifications">Hapus yang Dibaca</button></div></div><div class="notification-list">${list.length?list.map(n=>`<button class="notification-item ${n.read?'':'unread'}" data-open-notification="${n.id}"><span class="notification-icon">${n.type==='payment'?'Rp':'✚'}</span><span><b>${esc(n.title)}</b><small>${esc(n.message)}</small><time>${new Date(n.createdAt).toLocaleString('id-ID')}</time></span>${n.read?'':'<i>Baru</i>'}</button>`).join(''):'<div class="empty">Belum ada notifikasi.</div>'}</div></section>`}

function parentPaymentPage(){
 const a=parentAthlete(),mine=state.payments.filter(p=>p.athleteId===a?.id).slice().reverse()
 const openInvoices=state.invoices.filter(i=>i.athleteId===a.id&&i.status==='unpaid')
 return `<section class="card"><div class="card-head"><div><h3>Pembayaran</h3><small>Pilih pembayaran SPP atau biaya lomba.</small></div></div>
 <div class="payment-choice-grid"><button type="button" class="payment-choice active" data-payment-tab="spp"><b>Pembayaran SPP</b><span>SPP bulanan atlet</span></button><button type="button" class="payment-choice" data-payment-tab="competition"><b>Pembayaran Lomba</b><span>Biaya kejuaraan atlet</span></button></div>
 <div class="bank-card"><b>Transfer ke Bank Mandiri</b><span>Atas Nama: FAHMI DJAWAS</span><strong>1560020198356</strong><small>Pastikan nama penerima dan nomor rekening benar.</small></div>
 <form id="parentPaymentForm" class="form-grid">
 <input type="hidden" name="paymentType" value="spp">
 <label>Tagihan Tersedia<select name="invoiceId"><option value="">Pembayaran tanpa tagihan</option>${openInvoices.map(i=>`<option value="${i.id}">${esc(i.title)} — Rp${Number(i.amount).toLocaleString('id-ID')}</option>`).join('')}</select></label>
 <div id="sppFields"><label>Bulan SPP<input name="month" type="month"></label></div>
 <div id="competitionFields" hidden><label>Nama Kejuaraan<input name="competitionName" placeholder="Contoh: Bekasi Open 2026"></label><label>Tingkat Kejuaraan<select name="competitionLevel"><option>Daerah</option><option>Nasional</option><option>Internasional</option></select></label></div>
 <label>Nominal Pembayaran<input name="amount" type="number" min="1" required></label>
 <label>Bukti Pembayaran<input name="proof" type="file" accept="image/*,application/pdf" required></label>
 <label>Catatan<input name="note" placeholder="Opsional"></label>
 <button class="primary">Kirim Bukti Pembayaran</button><p id="paymentError" class="error"></p></form></section>
 <section class="card"><h3>Riwayat Pembayaran</h3>${mine.length?mine.map(p=>`<div class="payment-row"><div><b>${paymentTypeLabel(p.paymentType)}</b><small>${esc(p.paymentType==='competition'?(p.competitionName||'Lomba'):(p.month||'SPP'))} · Rp${Number(p.amount||0).toLocaleString('id-ID')}</small></div><span class="status status-${p.status}">${paymentStatusLabel(p.status)}</span></div>`).join(''):'<div class="empty">Belum ada pembayaran.</div>'}</section>`
}




function blobToBase64(blob){
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(reader.error||new Error('File tidak dapat dibaca.'));reader.readAsDataURL(blob)})
}
async function saveDownloadFile(blob,filename,mimeType='application/octet-stream'){
 try{
  if(window.AndroidDownloads&&typeof window.AndroidDownloads.saveBase64File==='function'){
   const base64=await blobToBase64(blob)
   window.AndroidDownloads.saveBase64File(filename,mimeType||blob.type||'application/octet-stream',base64)
   alert(`File ${filename} berhasil disimpan ke folder Download.`)
   return true
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),1500)
  return true
 }catch(error){console.error(error);alert(`Download gagal: ${error?.message||'Tidak dapat menyimpan file.'}`);return false}
}

async function downloadXmlExcel(filename,sheetName,headers,rows){
 const safe=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
 const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${safe(sheetName)}"><Table>${[headers,...rows].map(row=>`<Row>${row.map(value=>`<Cell><Data ss:Type="${typeof value==='number'?'Number':'String'}">${safe(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`
 const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'})
 await saveDownloadFile(blob,filename,'application/vnd.ms-excel')
}
function financeSummaryCardsOnlyLegacy(){
 const approved=(state.financeTransactions||[]).filter(p=>p.direction==='income').reduce((n,p)=>n+Number(p.amount||0),0)
 const pending=(state.financeTransactions||[]).filter(p=>p.direction==='expense').reduce((n,p)=>n+Number(p.amount||0),0)
 const unpaid=approved-pending
 const salary=(state.financeTransactions||[]).filter(p=>String(p.transactionDate||'').slice(0,7)===new Date().toISOString().slice(0,7)).reduce((n,p)=>n+(p.direction==='income'?Number(p.amount||0):-Number(p.amount||0)),0)
 return `<div class="dashboard-kpis finance-kpis"><article class="kpi-card green"><i>✓</i><div><span>Pembayaran Diterima</span><b>Rp${approved.toLocaleString('id-ID')}</b><small>Total terverifikasi</small></div></article><article class="kpi-card orange"><i>◷</i><div><span>Menunggu Verifikasi</span><b>Rp${pending.toLocaleString('id-ID')}</b><small>Bukti belum diperiksa</small></div></article><article class="kpi-card purple"><i>▦</i><div><span>Tagihan Belum Lunas</span><b>Rp${unpaid.toLocaleString('id-ID')}</b><small>Total piutang</small></div></article><article class="kpi-card"><i>Rp</i><div><span>Gaji Pelatih</span><b>Rp${salary.toLocaleString('id-ID')}</b><small>Total dibayarkan</small></div></article></div>`
}

function financeHistoryPanelLegacy(){
 const filters=window.__ascFinanceFilters||{},all=state.financeTransactions||[],categories=[...new Set(all.map(x=>x.category).filter(Boolean))]
 const rows=all.filter(x=>(!filters.month||String(x.transactionDate||'').slice(0,7)===filters.month)&&(!filters.direction||x.direction===filters.direction)&&(!filters.category||x.category===filters.category)&&(!filters.search||`${x.description||''} ${x.athleteName||''} ${x.coachName||''}`.toLowerCase().includes(filters.search.toLowerCase()))).sort((a,b)=>String(a.transactionDate).localeCompare(String(b.transactionDate)))
 let balance=0;const display=rows.map(x=>({...x,runningBalance:(balance+=x.direction==='income'?Number(x.amount||0):-Number(x.amount||0))})).reverse()
 return `<section class="card"><div class="card-head"><div><h3>Riwayat Transaksi Keuangan</h3><small>Satu baris untuk setiap transaksi.</small></div><div class="action-stack"><button class="primary small" data-add-finance="income">+ Pemasukan Manual</button><button class="secondary small" data-add-finance="expense">+ Pengeluaran Manual</button><button class="secondary small" id="downloadFinanceExcel">Download Excel</button><button class="secondary small" id="downloadFinancePdf">Download PDF</button></div></div><div class="athlete-filter-row"><input type="month" data-finance-filter="month" value="${esc(filters.month||'')}"><select data-finance-filter="direction"><option value="">Semua Jenis</option><option value="income" ${filters.direction==='income'?'selected':''}>Pemasukan</option><option value="expense" ${filters.direction==='expense'?'selected':''}>Pengeluaran</option></select><select data-finance-filter="category"><option value="">Semua Kategori</option>${categories.map(x=>`<option ${filters.category===x?'selected':''}>${esc(x)}</option>`).join('')}</select><input data-finance-filter="search" placeholder="Cari nama/keterangan" value="${esc(filters.search||'')}"></div><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Nama</th><th>Pemasukan</th><th>Pengeluaran</th><th>Saldo Berjalan</th><th>Bukti</th><th>Aksi</th></tr></thead><tbody>${display.length?display.map(x=>`<tr><td>${new Date(x.transactionDate).toLocaleDateString('id-ID')}</td><td>${x.direction==='income'?'Pemasukan':'Pengeluaran'}</td><td>${esc(x.category||'-')}</td><td>${esc(x.description||'-')}</td><td>${esc(x.athleteName||x.coachName||'-')}</td><td>${x.direction==='income'?`Rp${Number(x.amount).toLocaleString('id-ID')}`:'-'}</td><td>${x.direction==='expense'?`Rp${Number(x.amount).toLocaleString('id-ID')}`:'-'}</td><td>Rp${Number(x.runningBalance).toLocaleString('id-ID')}</td><td>${x.proofUrl?`<a href="${esc(x.proofUrl)}" target="_blank" rel="noopener">Lihat</a>`:'-'}</td><td>${x.referenceType==='manual'?`<button class="danger tiny" data-delete-finance="${x.id}">Hapus</button>`:'Otomatis'}</td></tr>`).join(''):'<tr><td colspan="10" class="empty">Belum ada transaksi.</td></tr>'}</tbody></table></div><dialog id="financeDialog"><form id="financeForm" class="modal-form"><div class="card-head"><h3>Tambah Transaksi Manual</h3><button type="button" class="icon-btn" data-close>✕</button></div><label>Tanggal<input type="datetime-local" name="transactionDate" required></label><label>Jenis<select name="direction"><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select></label><label>Kategori<input name="category" required></label><label>Nominal<input type="number" min="1" name="amount" required></label><label>Keterangan<textarea name="description" required></textarea></label><label>Nama Terkait<input name="relatedName"></label><label>Bukti Opsional<input name="proof" type="file" accept="image/*,application/pdf"></label><button class="primary">Simpan Transaksi</button></form></dialog></section>`
}
function financeSummaryCardsLegacy(){
 const rows=state.financeTransactions||[],income=rows.filter(x=>x.direction==='income').reduce((n,x)=>n+Number(x.amount||0),0),expense=rows.filter(x=>x.direction==='expense').reduce((n,x)=>n+Number(x.amount||0),0),month=new Date().toISOString().slice(0,7),monthIncome=rows.filter(x=>x.direction==='income'&&String(x.transactionDate||'').slice(0,7)===month).reduce((n,x)=>n+Number(x.amount||0),0),monthExpense=rows.filter(x=>x.direction==='expense'&&String(x.transactionDate||'').slice(0,7)===month).reduce((n,x)=>n+Number(x.amount||0),0)
 return `<div class="dashboard-kpis finance-kpis"><article class="kpi-card green"><div><span>Total Pemasukan</span><b>Rp${income.toLocaleString('id-ID')}</b><small>Bulan ini Rp${monthIncome.toLocaleString('id-ID')}</small></div></article><article class="kpi-card orange"><div><span>Total Pengeluaran</span><b>Rp${expense.toLocaleString('id-ID')}</b><small>Bulan ini Rp${monthExpense.toLocaleString('id-ID')}</small></div></article><article class="kpi-card purple"><div><span>Saldo Kas</span><b>Rp${(income-expense).toLocaleString('id-ID')}</b><small>Pemasukan dikurangi pengeluaran</small></div></article></div>${financeHistoryPanel()}`
}
function activeFinanceRows(){return (state.financeTransactions||[]).filter(x=>!x.deletedAt)}
function financeFilteredRows(){
 const f=window.__ascFinanceFilters||{},q=String(f.search||'').toLowerCase()
 return activeFinanceRows().filter(x=>{const d=new Date(x.transactionDate||x.createdAt||0);return(!f.month||String(d.getMonth()+1).padStart(2,'0')===f.month)&&(!f.year||String(d.getFullYear())===f.year)&&(!f.direction||x.direction===f.direction)&&(!f.category||normalizeFinanceCategory(x.category)===f.category)&&(!q||`${x.transactionNumber||''} ${x.id||''} ${x.athleteName||''} ${x.coachName||''} ${x.category||''} ${x.transactionType||''} ${x.description||''}`.toLowerCase().includes(q))}).sort((a,b)=>new Date(b.transactionDate||0)-new Date(a.transactionDate||0))
}
function financeLineChart(rows){
 const grouped={};rows.forEach(x=>{const key=String(x.transactionDate||'').slice(0,10);grouped[key]||={income:0,expense:0};grouped[key][x.direction]+=Number(x.amount||0)})
 const points=Object.entries(grouped).sort().slice(-31),max=Math.max(1,...points.flatMap(([,v])=>[v.income,v.expense])),path=type=>points.map(([,v],i)=>`${points.length===1?50:i*100/(points.length-1)},${95-(v[type]/max)*85}`).join(' ')
 return points.length?`<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:180px"><polyline points="${path('income')}" fill="none" stroke="#18a66a" stroke-width="2"/><polyline points="${path('expense')}" fill="none" stroke="#e35d5d" stroke-width="2"/></svg><small>Hijau: pemasukan · Merah: pengeluaran</small>`:'<div class="empty compact-empty">Belum ada data grafik.</div>'
}
function financePieChart(rows,direction){
 const sums={};rows.filter(x=>x.direction===direction).forEach(x=>{const key=normalizeFinanceCategory(x.category);sums[key]=(sums[key]||0)+Number(x.amount||0)});const entries=Object.entries(sums),total=entries.reduce((n,[,v])=>n+v,0);if(!total)return '<div class="empty compact-empty">Belum ada data.</div>'
 const colors=['#0879d1','#18a66a','#f0a33b','#8a62d3','#e35d5d','#42b7c7'];let cursor=0;const stops=entries.map(([,v],i)=>{const start=cursor;cursor+=v/total*100;return `${colors[i%colors.length]} ${start}% ${cursor}%`}).join(',');return `<div style="display:flex;align-items:center;gap:18px"><div style="width:130px;height:130px;border-radius:50%;background:conic-gradient(${stops})"></div><div>${entries.map(([k,v],i)=>`<p style="margin:5px 0"><i style="display:inline-block;width:10px;height:10px;background:${colors[i%colors.length]}"></i> ${esc(k)} <b>Rp${v.toLocaleString('id-ID')}</b></p>`).join('')}</div></div>`
}
function financeCash12MonthChart(rows){
 const now=new Date(),months=Array.from({length:12},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-11+i,1);return{key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleDateString('id-ID',{month:'short'})}}),values=months.map(m=>rows.filter(x=>String(x.transactionDate||'').slice(0,7)===m.key).reduce((n,x)=>n+(x.direction==='income'?Number(x.amount||0):-Number(x.amount||0)),0)),max=Math.max(1,...values.map(Math.abs));return `<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:5px;height:180px;align-items:end">${values.map((v,i)=>`<div title="${months[i].key}: Rp${v.toLocaleString('id-ID')}" style="height:${Math.max(4,Math.abs(v)/max*150)}px;background:${v>=0?'#0879d1':'#e35d5d'};border-radius:5px 5px 0 0"><small style="display:block;transform:translateY(155px);text-align:center">${months[i].label}</small></div>`).join('')}</div>`}
function financeSummaryCards(){
 const rows=activeFinanceRows(),now=new Date(),today=now.toISOString().slice(0,10),month=today.slice(0,7),income=rows.filter(x=>x.direction==='income').reduce((n,x)=>n+Number(x.amount||0),0),expense=rows.filter(x=>x.direction==='expense').reduce((n,x)=>n+Number(x.amount||0),0),todayRows=rows.filter(x=>String(x.transactionDate||'').slice(0,10)===today),monthRows=rows.filter(x=>String(x.transactionDate||'').slice(0,7)===month),sum=(list,d)=>list.filter(x=>x.direction===d).reduce((n,x)=>n+Number(x.amount||0),0),cards=[['Total Pemasukan Hari Ini',sum(todayRows,'income')],['Total Pengeluaran Hari Ini',sum(todayRows,'expense')],['Saldo Kas Saat Ini',income-expense],['Pemasukan Bulan Ini',sum(monthRows,'income')],['Pengeluaran Bulan Ini',sum(monthRows,'expense')],['Saldo Bulan Ini',sum(monthRows,'income')-sum(monthRows,'expense')],['Jumlah Transaksi Bulan Ini',monthRows.length]]
 return `<div class="dashboard-kpis finance-kpis">${cards.map(([label,value],i)=>`<article class="kpi-card ${i===0||i===3?'green':i===1||i===4?'orange':i===2||i===5?'purple':''}"><div><span>${label}</span><b>${i===6?Number(value).toLocaleString('id-ID'):`Rp${Number(value).toLocaleString('id-ID')}`}</b></div></article>`).join('')}</div><div class="grid-2"><section class="card"><h3>Pemasukan vs Pengeluaran</h3>${financeLineChart(monthRows)}</section><section class="card"><h3>Grafik Kas 12 Bulan</h3>${financeCash12MonthChart(rows)}</section><section class="card"><h3>Kategori Pemasukan</h3>${financePieChart(rows,'income')}</section><section class="card"><h3>Kategori Pengeluaran</h3>${financePieChart(rows,'expense')}</section></div>${financeHistoryPanel()}`
}
function financeHistoryPanel(){
 const filters=window.__ascFinanceFilters||{},rows=financeFilteredRows(),categories=[...new Set(activeFinanceRows().map(x=>normalizeFinanceCategory(x.category)).filter(Boolean))].sort(),years=[...new Set(activeFinanceRows().map(x=>String(x.transactionDate||'').slice(0,4)).filter(Boolean))].sort().reverse(),pageSize=10,totalPages=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(totalPages,Math.max(1,Number(window.__ascFinancePage||1)));window.__ascFinancePage=page;const shown=rows.slice((page-1)*pageSize,page*pageSize)
 return `<section class="card"><div class="card-head"><div><h3>Riwayat Transaksi Keuangan</h3><small>${rows.length} transaksi · halaman ${page}/${totalPages}</small></div><div class="action-stack"><button class="primary small" data-add-finance="income">+ Pemasukan Manual</button><button class="secondary small" data-add-finance="expense">+ Pengeluaran Manual</button><button class="secondary small" id="downloadFinanceExcel">Download Excel</button><button class="secondary small" id="downloadFinancePdf">Download PDF</button></div></div><div class="athlete-filter-row"><select data-finance-filter="month"><option value="">Semua Bulan</option>${Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(x=>`<option value="${x}" ${filters.month===x?'selected':''}>${new Date(2026,Number(x)-1,1).toLocaleDateString('id-ID',{month:'long'})}</option>`).join('')}</select><select data-finance-filter="year"><option value="">Semua Tahun</option>${years.map(x=>`<option ${filters.year===x?'selected':''}>${x}</option>`).join('')}</select><select data-finance-filter="direction"><option value="">Semua Jenis</option><option value="income" ${filters.direction==='income'?'selected':''}>Pemasukan</option><option value="expense" ${filters.direction==='expense'?'selected':''}>Pengeluaran</option></select><select data-finance-filter="category"><option value="">Semua Kategori</option>${categories.map(x=>`<option ${filters.category===x?'selected':''}>${esc(x)}</option>`).join('')}</select><input data-finance-filter="search" placeholder="Cari nomor, atlet, pelatih, SPP, lomba, gaji..." value="${esc(filters.search||'')}"></div><div class="table-wrap"><table><thead><tr><th>Nomor</th><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Nama</th><th>Nominal</th><th>Aksi</th></tr></thead><tbody>${shown.length?shown.map(x=>`<tr><td><b>${esc(x.transactionNumber||x.id)}</b></td><td>${new Date(x.transactionDate).toLocaleString('id-ID')}</td><td>${x.direction==='income'?'Pemasukan':'Pengeluaran'}</td><td>${esc(normalizeFinanceCategory(x.category))}</td><td>${esc(x.description||'-')}</td><td>${esc(x.athleteName||x.coachName||'-')}</td><td>Rp${Number(x.amount||0).toLocaleString('id-ID')}</td><td><button class="secondary tiny" data-view-finance="${x.id}">Detail</button>${x.referenceType==='manual'?`<button class="danger tiny" data-delete-finance="${x.id}">Hapus</button>`:''}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">Belum ada transaksi.</td></tr>'}</tbody></table></div><div class="dialog-actions"><button class="secondary small" data-finance-page="${page-1}" ${page<=1?'disabled':''}>Sebelumnya</button><button class="secondary small" data-finance-page="${page+1}" ${page>=totalPages?'disabled':''}>Berikutnya</button></div><dialog id="financeDialog"><form id="financeForm" class="modal-form"><div class="card-head"><h3>Tambah Transaksi Manual</h3><button type="button" class="icon-btn" data-close>✕</button></div><label>Tanggal<input type="datetime-local" name="transactionDate" required></label><label>Jenis<select name="direction"><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select></label><label>Kategori<input name="category" required></label><label>Nominal<input type="number" min="1" name="amount" required></label><label>Keterangan<textarea name="description" required></textarea></label><label>Nama Terkait<input name="relatedName"></label><label>Bukti Opsional<input name="proof" type="file" accept="image/*,application/pdf"></label><button class="primary">Simpan Transaksi</button></form></dialog><dialog id="financeDetailDialog"><div class="modal-form"><div class="card-head"><h3>Detail Transaksi</h3><button type="button" class="icon-btn" data-close>✕</button></div><div id="financeDetailContent"></div></div></dialog></section>`
}
function paymentsPage(){
 const rows=state.payments.slice().reverse()
 return `${financeSummaryCards()}<section class="card"><div class="card-head"><div><h3>Verifikasi Pembayaran</h3><small>${rows.filter(p=>p.status==='pending').length} pembayaran menunggu konfirmasi</small></div><button class="secondary small" id="downloadPaymentsExcel">⬇ Download Excel</button></div><div class="table-wrap"><table><thead><tr><th>Atlet</th><th>Jenis</th><th>Keterangan</th><th>Nominal</th><th>Bukti</th><th>Tanggal</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.length?rows.map(p=>`<tr><td>${esc(p.athleteName)}</td><td>${paymentTypeLabel(p.paymentType)}</td><td>${esc(p.paymentType==='competition'?(p.competitionName||'Lomba'):(p.month||'SPP'))}${p.competitionLevel?`<small class="cell-sub">${esc(p.competitionLevel)}</small>`:''}</td><td>Rp${Number(p.amount||0).toLocaleString('id-ID')}</td><td>${p.proof?`<button class="proof-link" data-preview-payment-proof="${p.id}">Preview Bukti</button>`:'-'}</td><td>${new Date(p.submittedAt||Date.now()).toLocaleString('id-ID')}</td><td><span class="status status-${p.status}">${paymentStatusLabel(p.status)}</span></td><td>${p.status==='pending'?`<div class="action-stack"><button class="primary tiny" data-approve-payment="${p.id}">Konfirmasi</button><button class="danger tiny" data-reject-payment="${p.id}">Tolak</button></div>`:'-'}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">Belum ada pembayaran.</td></tr>'}</tbody></table></div><dialog id="paymentProofDialog" class="document-preview-dialog"><div class="modal-form document-preview-shell"><div class="card-head"><div><h3>Preview Bukti Pembayaran</h3><small id="paymentProofMeta"></small></div><button type="button" class="icon-btn" data-close>✕</button></div><div id="paymentProofContent" class="document-preview-content"></div><a id="paymentProofDownload" class="primary inline-button" download>Download Bukti</a></div></dialog></section>`
}
function registrationsPage(){
 const rows=(state.pendingRegistrations||[]).slice().sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)))
 return `<section class="card"><div class="card-head"><div><h3>Verifikasi Pendaftar Baru</h3><small>${rows.filter(r=>r.status==='pending').length} pendaftaran menunggu konfirmasi</small></div></div>
 <div class="table-wrap"><table><thead><tr><th>Foto</th><th>Kode/Nama</th><th>JK</th><th>Lahir/Umur</th><th>WhatsApp</th><th>Kelas</th><th>Paket</th><th>Dokumen</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
 ${rows.length?rows.map(r=>`<tr>
 <td>${r.photo?`<img class="athlete-photo" src="${r.photo}" alt="${esc(r.name)}">`:'-'}</td>
 <td><small class="cell-sub">${esc(r.id)}</small><b>${esc(r.name)}</b><small class="cell-sub">${new Date(r.submittedAt).toLocaleString('id-ID')}</small></td>
 <td>${esc(r.gender)}</td><td>${esc(r.birth)}<small class="cell-sub">${esc(r.age)} tahun · ${esc(r.ageGroup)}</small></td><td>${esc(r.parentWhatsapp||'-')}</td>
 <td>${esc(r.classCategory)}</td><td>${esc(r.package)}</td>
 <td><div class="doc-links">${r.certificate?`<button type="button" class="secondary tiny" data-preview-document="certificate" data-registration-id="${r.id}">Preview Akta</button>`:''}${r.paymentProof?`<button type="button" class="secondary tiny" data-preview-document="paymentProof" data-registration-id="${r.id}">Preview Bukti Bayar</button>`:''}</div></td>
 <td><span class="status status-${r.status}">${registrationStatusLabel(r.status)}</span>${r.adminNote?`<small class="cell-sub">${esc(r.adminNote)}</small>`:''}${r.athleteId?`<small class="cell-sub">ID: ${esc(r.athleteId)}</small>`:''}</td>
 <td><div class="action-stack"><button class="secondary tiny" data-edit-registration="${r.id}">Edit</button>${r.status==='pending'?`<button class="primary tiny" data-approve-registration="${r.id}">Konfirmasi</button><button class="danger tiny" data-reject-registration="${r.id}">Tolak</button>`:`<button class="danger tiny" data-delete-registration="${r.id}">Hapus</button>`}</div></td>
 </tr>`).join(''):'<tr><td colspan="10" class="empty">Belum ada pendaftaran baru.</td></tr>'}
 </tbody></table></div></section>
 <dialog id="registrationEditDialog"><form id="registrationEditForm" class="modal-form"><input type="hidden" name="editId"><div class="card-head"><h3>Edit Pendaftaran Atlet</h3><button type="button" class="icon-btn" data-close>✕</button></div><div class="form-two"><label>Nama Atlet<input name="name" required></label><label>Jenis Kelamin<select name="gender" required><option>Laki-Laki</option><option>Perempuan</option></select></label><label>Tanggal Lahir<input name="birth" type="date" required></label><label>No. WhatsApp Orang Tua<input name="parentWhatsapp" required></label><label>Kategori Kelas<select name="classCategory" required><option>Group</option><option>Private</option></select></label><label>Paket<select name="package" required><option>Paket 1</option><option>Paket 2</option></select></label><label class="full-field">Catatan Kesehatan<textarea name="healthNote" rows="3"></textarea></label></div><button class="primary">Simpan Perubahan</button></form></dialog>
 <dialog id="documentPreviewDialog" class="document-preview-dialog"><div class="modal-form document-preview-shell"><div class="card-head"><h3 id="documentPreviewTitle">Preview Berkas</h3><button type="button" class="icon-btn" data-close>✕</button></div><div id="documentPreviewContent" class="document-preview-content"></div><a id="documentDownloadLink" class="primary inline-button" download>Download Berkas</a></div></dialog>`
}
function coachesPage(){return `<section class="card"><div class="card-head"><div><h3>Data Pelatih</h3><small>Admin dapat mengubah nama, username, status, password, dan foto profil pelatih.</small></div><button class="primary small" id="addCoach">+ Tambah Pelatih</button></div><div class="table-wrap"><table><thead><tr><th>Foto</th><th>ID</th><th>Nama</th><th>Username</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${state.coaches.length?state.coaches.map(c=>`<tr><td>${c.photo?`<img class="table-avatar" src="${c.photo}" alt="Foto ${esc(c.name)}">`:'<span class="table-avatar placeholder">♟</span>'}</td><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td>${esc(c.username)}</td><td><span class="status status-${c.active===false?'rejected':'approved'}">${c.active===false?'Tidak Aktif':'Aktif'}</span></td><td class="action-cell"><button class="primary tiny" data-edit-coach="${c.id}">Edit</button><button class="danger tiny" data-delete-coach="${c.id}">Hapus</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Belum ada pelatih.</td></tr>'}</tbody></table></div></section><dialog id="coachDialog"><form id="coachForm" class="modal-form"><input type="hidden" name="editId"><div class="card-head"><h3 id="coachDialogTitle">Tambah Pelatih</h3><button type="button" class="icon-btn" data-close>✕</button></div><div id="coachCurrentPhoto" class="coach-current-photo"></div><label>Foto Profil Pelatih<input name="photo" type="file" accept="image/*"></label><small class="hint">Kosongkan saat mengedit bila foto lama tetap digunakan.</small><label>Nama Pelatih<input name="name" required></label><label>Username<input name="username" required></label><label>Status<select name="active"><option value="true">Aktif</option><option value="false">Tidak Aktif</option></select></label><label id="coachPasswordLabel">Password Awal<input name="password" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}"></label><small class="hint">Saat mengedit, isi password hanya jika ingin menggantinya.</small><button class="primary">Simpan Pelatih</button></form></dialog>`}

function addCoachNotification(coachId,title,message,page='coachSalaryHistory'){
 const notification={
  id:`CN-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
  coachId,title,message,page,notificationAudience:'coach',read:false,createdAt:new Date().toISOString()
 }
 state.coachNotifications.push(notification)
 persistDedicatedSoon('coachNotifications',notification.id)
 sendPushNotification({target:'coach',coachId,title,message,page,eventId:notification.id})
}
function coachUnreadCount(coachId){
 return state.coachNotifications.filter(n=>n.coachId===coachId&&!n.read).length
}
function salaryStatusLabel(status){
 return status==='paid'?'Sudah Dibayar':status==='cancelled'?'Dibatalkan':'Menunggu'
}
function formatSalaryDate(value){
 if(!value)return '-'
 const date=new Date(value)
 if(Number.isNaN(date.getTime()))return '-'
 return date.toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})
}
function formatSalaryTime(value){
 if(!value)return '-'
 const date=new Date(value)
 if(Number.isNaN(date.getTime()))return '-'
 return `${date.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} WIB`
}
function coachSalaryHistoryPage(){
 const c=currentCoach(),rows=state.coachSalaries.filter(x=>x.coachId===c?.id).slice().sort((a,b)=>String(b.paidAt||b.createdAt).localeCompare(String(a.paidAt||a.createdAt)))
 return `<section class="card"><div class="card-head"><div><h3>Riwayat Gaji Pelatih</h3><small>Daftar pembayaran gaji dari admin.</small></div></div>
 <div class="table-wrap"><table><thead><tr><th>Periode Gaji</th><th>Nominal</th><th>Tanggal Pembayaran</th><th>Waktu Pembayaran</th><th>Keterangan</th><th>Bukti</th><th>Status</th></tr></thead><tbody>
 ${rows.length?rows.map(s=>`<tr><td>${esc(s.period)}</td><td>Rp${Number(s.amount||0).toLocaleString('id-ID')}</td><td><b>${formatSalaryDate(s.paidAt)}</b></td><td>${formatSalaryTime(s.paidAt)}</td><td>${esc(s.note||'-')}</td><td>${s.proof?`<button type="button" class="proof-link" data-preview-proof="salary" data-record-id="${s.id}">Lihat Bukti Pembayaran</button>`:'-'}</td><td><span class="status status-${s.status==='paid'?'approved':s.status==='cancelled'?'rejected':'pending'}">${salaryStatusLabel(s.status)}</span></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Belum ada pembayaran gaji.</td></tr>'}
 </tbody></table></div></section>`
}
function coachNotificationsPage(){
 const c=currentCoach(),rows=state.coachNotifications.filter(n=>n.coachId===c?.id).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
 return `<section class="card"><div class="card-head"><div><h3>Notifikasi Pelatih</h3><small>${rows.filter(n=>!n.read).length} notifikasi belum dibaca</small></div><button class="secondary small" id="markCoachNotificationsRead">Tandai Semua Dibaca</button></div>
 ${rows.length?rows.map(n=>`<article class="notification-item ${n.read?'':'unread'}" data-coach-notification="${n.id}"><div><b>${esc(n.title)}</b><p>${esc(n.message)}</p><small>${new Date(n.createdAt).toLocaleString('id-ID')}</small></div><span>${n.read?'✓':'●'}</span></article>`).join(''):'<div class="empty">Belum ada notifikasi.</div>'}</section>`
}
function coachSalariesPage(){
 const rows=state.coachSalaries.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
 return `<section class="card"><div class="card-head"><div><h3>Gaji Pelatih</h3><small>Catat pembayaran gaji dan kirim notifikasi ke pelatih.</small></div><div class="action-stack"><button class="secondary small" id="downloadSalariesExcel">⬇ Download Excel</button><button class="primary small" id="addCoachSalary">+ Bayar Gaji</button></div></div>
 <div class="table-wrap"><table><thead><tr><th>Pelatih</th><th>Periode Gaji</th><th>Nominal</th><th>Tanggal Pembayaran</th><th>Waktu Pembayaran</th><th>Keterangan</th><th>Bukti</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
 ${rows.length?rows.map(s=>`<tr><td>${esc(s.coachName)}</td><td>${esc(s.period)}</td><td>Rp${Number(s.amount||0).toLocaleString('id-ID')}</td><td><b>${formatSalaryDate(s.paidAt)}</b></td><td>${formatSalaryTime(s.paidAt)}</td><td>${esc(s.note||'-')}</td><td>${s.proof?`<button type="button" class="proof-link" data-preview-proof="salary" data-record-id="${s.id}">Lihat Bukti</button>`:'-'}</td><td><span class="status status-${s.status==='paid'?'approved':s.status==='cancelled'?'rejected':'pending'}">${salaryStatusLabel(s.status)}</span></td><td><button class="danger tiny" data-delete-salary="${s.id}">Hapus</button></td></tr>`).join(''):'<tr><td colspan="9" class="empty">Belum ada pembayaran gaji.</td></tr>'}
 </tbody></table></div></section>
 <dialog id="coachSalaryDialog"><form id="coachSalaryForm" class="modal-form"><div class="card-head"><h3>Pembayaran Gaji Pelatih</h3><button type="button" data-close class="icon-btn">✕</button></div>
 <label>Pelatih<select name="coachId" required>${state.coaches.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
 <label>Periode Gaji<input name="period" required placeholder="Contoh: Juli 2026"></label>
 <label>Nominal Gaji<input name="amount" type="number" min="1" required></label>
 <div class="auto-date-note salary-auto-date"><b>Tanggal dan waktu pembayaran otomatis</b><strong id="salaryAutoDatePreview">${formatSalaryDate(new Date())} · ${formatSalaryTime(new Date())}</strong><span>Tanggal, bulan, tahun, dan jam di atas akan tersimpan otomatis saat tombol Bayar Gaji ditekan. Admin tidak perlu mengisi tanggal secara manual.</span></div>
 <label>Bukti Pembayaran<input name="proof" type="file" accept="image/*,.pdf" required></label>
 <label>Keterangan<textarea name="note" rows="3" placeholder="Contoh: Gaji pelatih bulan Juli 2026"></textarea></label>
 <button class="primary">Bayar Gaji Sekarang</button><p id="coachSalaryError" class="error"></p></form></dialog>`
}
function coachDashboard(){
 const c=currentCoach()
 const records=state.timeRecords.filter(r=>r.coachId===c?.id||r.coachName===c?.name)
 const today=todayAttendance(),hadir=today.filter(r=>r.status==='Hadir').length
 const programCount=state.trainingPrograms.length
 const todaySchedules=state.schedules.filter(s=>s.day===currentDayName())
 const unread=coachUnreadCount(c?.id)
 return `<div class="dashboard-heading"><div><p>Dashboard Pelatih</p><h1>${esc(c?.name||'Pelatih ASC')}</h1></div><span>${unread} notifikasi belum dibaca</span></div>
 <div class="dashboard-kpis">
  <article class="kpi-card"><i>♟</i><div><span>Atlet Binaan</span><b>${state.athletes.length}</b><small>Atlet aktif</small></div></article>
  <article class="kpi-card purple"><i>▣</i><div><span>Program Aktif</span><b>${programCount}</b><small>Program latihan</small></div></article>
  <article class="kpi-card green"><i>✓</i><div><span>Sesi Hari Ini</span><b>${todaySchedules.length}</b><small>Sesi latihan</small></div></article>
  <article class="kpi-card orange"><i>◔</i><div><span>Kehadiran</span><b>${today.length?Math.round(hadir/today.length*100):0}%</b><small>Rata-rata hari ini</small></div></article>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Program Latihan Hari Ini</h3><button data-page="trainingPrograms">Lihat Semua</button></div>${state.trainingPrograms.slice(-3).reverse().map(p=>`<div class="dashboard-list-row"><b>${esc(p.title)}</b><span>${esc((p.categories||[]).join(', ')||'Semua Atlet')}</span><em>${esc((p.trainingGroups||[]).join(', ')||'Semua KU')}</em></div>`).join('')||'<div class="empty compact-empty">Belum ada program.</div>'}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Kehadiran Sesi Hari Ini</h3><button data-page="coachAttendance">Lihat Semua</button></div>${pieChart([{label:'Hadir',value:hadir},{label:'Tidak Hadir',value:Math.max(0,today.length-hadir)}],'Ringkasan Kehadiran')}</section>
 </div>
 <div class="dashboard-grid-main">
  <section class="card dashboard-panel"><div class="panel-head"><h3>Atlet Binaan Terbaru</h3><button data-page="coachAthletes">Lihat Semua</button></div>${state.athletes.slice(-4).reverse().map(a=>`<div class="athlete-mini-row">${a.photo?`<img src="${a.photo}">`:'<i>♟</i>'}<div><b>${esc(a.name)}</b><small>${esc(a.trainingCategory||'Pemula')} · ${esc((a.trainingGroups||[]).join(', ')||a.ageGroup)}</small></div></div>`).join('')}</section>
  <section class="card dashboard-panel"><div class="panel-head"><h3>Catatan Pelatih</h3><button data-page="coachDevelopment">Evaluasi</button></div><div class="coach-note-final"><i>▣</i><p>Berikan evaluasi teknik, endurance, disiplin, dan sikap atlet secara berkala agar orang tua dapat memantau perkembangannya.</p></div></section>
 </div>
 <section class="card dashboard-panel"><div class="panel-head"><h3>Catatan Waktu Terbaru</h3><button data-page="coachTimeRecords">Lihat Semua</button></div>${records.slice(-5).reverse().map(r=>`<div class="dashboard-list-row"><b>${esc(r.athleteName)}</b><span>${esc(r.stroke)} · ${esc(r.type)}</span><em>${esc(r.time)}</em></div>`).join('')||'<div class="empty compact-empty">Belum ada catatan waktu.</div>'}</section>`
}
function coachTimeRecords(){return timeRecordsPage()}
function coachPasswordPage(){
 const c=currentCoach()
 return `<section class="card password-card"><h2>Ganti Password Pelatih</h2><p>Selamat datang, ${esc(c?.name||'Pelatih')}. Untuk keamanan akun, Anda wajib mengganti password awal sebelum membuka portal pelatih.</p><form id="coachPasswordForm" class="form-grid"><label>Password Baru<input name="password" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" required></label><label>Ulangi Password Baru<input name="confirm" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" required></label><button class="primary">Simpan Password dan Masuk</button><p id="coachPasswordError" class="error"></p></form></section>`
}
function coachSettingsPage(){
 const c=currentCoach()
 return `<section class="card coach-profile-settings"><h3>Foto Profil Pelatih</h3><div class="coach-profile-preview">${c?.photo?`<img src="${c.photo}" alt="Foto ${esc(c.name)}">`:'<span>♟</span>'}<div><b>${esc(c?.name||'Pelatih')}</b><small>${esc(c?.id||'')}</small></div></div><form id="coachPhotoForm" class="form-grid"><label>Pilih Foto Baru<input name="photo" type="file" accept="image/*" required></label><button class="primary">Upload Foto Profil</button><p id="coachPhotoError" class="error"></p></form></section><section class="card"><h3>Pengaturan Akun Pelatih</h3><p>Ubah password akun ${esc(c?.name||'Pelatih')}.</p><form id="coachSettingsPasswordForm" class="form-grid"><label>Password Saat Ini<input name="currentPassword" type="password" required></label><label>Password Baru<input name="password" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" required></label><label>Ulangi Password Baru<input name="confirm" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" required></label><button class="primary">Ganti Password Pelatih</button><p id="coachSettingsError" class="error"></p></form></section>`
}
function parentPasswordPage(){const a=parentAthlete();return `<section class="card password-card"><h2>Ganti Password Orang Tua</h2><p>Untuk keamanan akun ${esc(a?.name||'atlet')}, buat password baru yang tepat 6 karakter.</p><div class="notice">Password boleh berupa 6 angka, 6 huruf, atau gabungan huruf dan angka. Contoh: <b>123456</b>, <b>aqilah</b>, atau <b>abc123</b>.</div><form id="parentPasswordForm" class="form-grid"><label>Password Baru<input name="password" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" pattern="[A-Za-z0-9]{6}" required></label><label>Ulangi Password<input name="confirm" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" pattern="[A-Za-z0-9]{6}" required></label><button class="primary">Simpan Password dan Masuk</button><p id="passwordError" class="error"></p></form></section>`}
function announcementsPage(){
 const rows=(state.announcements||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
 return `<section class="card"><div class="card-head"><h3>Pengumuman</h3><button class="primary small" id="addAnnouncement">+ Tambah Pengumuman</button></div><div class="announcement-admin-list">${rows.length?rows.map(a=>`<article class="announcement-admin-row"><div><b>${esc(a.title)}</b><small>${esc(a.date||'')}</small><p>${esc(a.body||'')}</p></div><div class="action-stack"><button class="primary tiny" data-edit-announcement="${a.id}">Edit</button><button class="danger tiny" data-delete-announcement="${a.id}">Hapus</button></div></article>`).join(''):'<div class="empty">Belum ada pengumuman.</div>'}</div></section>
 <dialog id="announcementDialog"><form id="announcementForm" class="modal-form"><input type="hidden" name="editId"><div class="card-head"><h3 id="announcementDialogTitle">Tambah Pengumuman</h3><button type="button" class="icon-btn" data-close>✕</button></div><label>Judul<input name="title" required></label><label>Isi<textarea name="body" rows="5" required></textarea></label><button class="primary">Simpan Pengumuman</button></form></dialog>`
}
function reportsPage(){
 const hadir=state.attendance.filter(r=>r.status==='Hadir').length
 return `<div class="dashboard-kpis"><article class="kpi-card"><i>♟</i><div><span>Total Atlet</span><b>${state.athletes.length}</b></div></article><article class="kpi-card green"><i>✓</i><div><span>Total Kehadiran</span><b>${hadir}</b></div></article><article class="kpi-card purple"><i>⏱</i><div><span>Catatan Waktu</span><b>${state.timeRecords.length}</b></div></article><article class="kpi-card orange"><i>Rp</i><div><span>Pembayaran</span><b>${state.payments.length}</b></div></article></div><section class="card"><h3>Laporan Ringkas Klub</h3><p class="hint">Ringkasan data operasional AQILAH Swimming Club.</p></section>`
}


const ATHLETE_EXPORT_ADDRESS = 'Villa Mutiara Gading 2, Perumahan Jl. Raya Bumi Anggrek No.1-2 Blok D2, Karangsatria, Kec. Tambun Utara, Kabupaten Bekasi, Jawa Barat 17510'

function athleteExportRows(){
 return (state.athletes||[]).slice().sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''))).map((a,index)=>[
  index+1,
  a.id||'',
  a.name||'',
  a.gender||'',
  a.birth||'',
  Number.isFinite(a.age)?a.age:calcAge(a.birth),
  a.ageGroup||calcGroup(a.birth),
  a.trainingCategory||'Pemula'
 ])
}
function safeExportFilename(ext){
 const date=new Date().toISOString().slice(0,10)
 return `DATA-ATLET-AQILAH-SWIMMING-CLUB-${date}.${ext}`
}
function downloadAthletesExcel(){
 const headers=['NO','ID - ATLET','NAMA','JK','TANGGAL LAHIR','UMUR','KU','KATEGORI']
 const rows=athleteExportRows()
 const data=[['','','',ATHLETE_EXPORT_ADDRESS,'','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],headers,...rows]
 const ws=XLSX.utils.aoa_to_sheet(data)
 ws['!merges']=[XLSX.utils.decode_range('A1:H4')]
 ws['!cols']=[{wch:6},{wch:16},{wch:30},{wch:14},{wch:18},{wch:10},{wch:12},{wch:18}]
 ws['!rows']=[{hpt:26},{hpt:24},{hpt:24},{hpt:24},{hpt:32},...rows.map(()=>({hpt:22}))]
 const thin={style:'thin',color:{rgb:'000000'}}
 const border={top:thin,bottom:thin,left:thin,right:thin}
 const titleCell=ws.A1
 titleCell.s={alignment:{horizontal:'center',vertical:'center',wrapText:true},font:{name:'Arial',sz:14,bold:true}}
 for(let c=0;c<8;c++){
  const cell=ws[XLSX.utils.encode_cell({r:4,c})]
  cell.s={font:{name:'Arial',sz:11,bold:true},alignment:{horizontal:'center',vertical:'center',wrapText:true},border,fill:{fgColor:{rgb:'D9EAF7'}}}
 }
 for(let r=5;r<5+rows.length;r++){
  for(let c=0;c<8;c++){
   const cell=ws[XLSX.utils.encode_cell({r,c})]
   if(!cell) continue
   cell.s={font:{name:'Arial',sz:10},alignment:{horizontal:c===2?'left':'center',vertical:'center',wrapText:true},border}
  }
 }
 const wb=XLSX.utils.book_new()
 XLSX.utils.book_append_sheet(wb,ws,'Data Atlet')
 const array=XLSX.write(wb,{bookType:'xlsx',type:'array'})
 const blob=new Blob([array],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
 saveDownloadFile(blob,safeExportFilename('xlsx'),blob.type)
}
function downloadAthletesPdf(){
 const rows=athleteExportRows().map(r=>[r[0],r[1],r[2],r[3],r[4],`${r[5]} tahun`,r[6],r[7]])
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
 doc.setFont('helvetica','bold');doc.setFontSize(15)
 doc.text('DATA ATLET AQILAH SWIMMING CLUB',148.5,13,{align:'center'})
 doc.setFont('helvetica','normal');doc.setFontSize(8.5)
 const addressLines=doc.splitTextToSize(ATHLETE_EXPORT_ADDRESS,250)
 doc.text(addressLines,148.5,19,{align:'center'})
 autoTable(doc,{
  startY:28,
  head:[['NO','ID - ATLET','NAMA','JK','TANGGAL LAHIR','UMUR','KU','KATEGORI']],
  body:rows,
  theme:'grid',
  styles:{font:'helvetica',fontSize:7.5,cellPadding:2,valign:'middle',overflow:'linebreak'},
  headStyles:{fontStyle:'bold',halign:'center',fillColor:[217,234,247],textColor:[0,0,0],lineColor:[0,0,0],lineWidth:0.2},
  bodyStyles:{lineColor:[0,0,0],lineWidth:0.15},
  columnStyles:{0:{cellWidth:10,halign:'center'},1:{cellWidth:25,halign:'center'},2:{cellWidth:55},3:{cellWidth:22,halign:'center'},4:{cellWidth:30,halign:'center'},5:{cellWidth:20,halign:'center'},6:{cellWidth:20,halign:'center'},7:{cellWidth:30,halign:'center'}},
  didDrawPage:()=>{
   const page=doc.internal.getNumberOfPages()
   doc.setFontSize(7);doc.text(`Halaman ${page}`,285,202,{align:'right'})
  }
 })
 const blob=doc.output('blob')
 saveDownloadFile(blob,safeExportFilename('pdf'),'application/pdf')
}

function athleteTable(){
 const canManage=role==='admin'
 const rows=state.athletes.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))
 return `<section class="card"><div class="card-head"><div><h3>Data Atlet</h3><small>${rows.length} atlet terdaftar — ID berikutnya: <b>${nextAthleteId()}</b> — nomor kosong otomatis dipakai kembali</small></div>${canManage?'<div class="athlete-export-actions"><button class="secondary small" id="downloadAthletesPdf">Download PDF</button><button class="secondary small" id="downloadAthletesExcel">Download Excel</button><button class="primary small" id="addAthlete">+ Tambah Atlet</button></div>':''}</div>
 <div class="athlete-filter-row"><input id="athleteSearch" placeholder="Cari ID atau nama atlet"><select id="athleteKuFilter"><option value="">Semua KU</option>${['KU 1','KU 2','KU 3','KU 4','KU 5A','KU 5B'].map(x=>`<option>${x}</option>`).join('')}</select></div>
 <div class="table-wrap"><table id="athleteDataTable"><thead><tr><th>Foto</th><th>ID Atlet</th><th>Nama Atlet</th><th>JK</th><th>Tempat, Tanggal Lahir</th><th>Umur</th><th>KU</th><th>Kategori</th><th>Sekolah</th><th>Nomor Telepon</th>${canManage?'<th>Aksi</th>':''}</tr></thead><tbody>
 ${rows.map(a=>`<tr data-athlete-row data-name="${esc((a.id+' '+a.name+' '+(a.schoolName||'')).toLowerCase())}" data-ku="${esc(a.ageGroup||calcGroup(a.birth))}"><td>${a.photo?`<img class="table-avatar" src="${a.photo}" alt="Foto ${esc(a.name)}">`:'<span class="table-avatar placeholder">♟</span>'}</td><td><b>${esc(a.id)}</b></td><td>${esc(a.name)}</td><td>${esc(a.gender||'-')}</td><td>${esc([a.birthPlace,a.birth].filter(Boolean).join(', ')||'-')}</td><td>${Number.isFinite(a.age)?a.age:calcAge(a.birth)} tahun</td><td>${esc(a.ageGroup||calcGroup(a.birth))}</td><td>${esc(a.trainingCategory||'Pemula')}</td><td>${esc(a.schoolName||'-')}</td><td>${esc(a.parentPhone||a.parentWhatsapp||'-')}</td>${canManage?`<td class="action-cell"><button class="secondary tiny" data-view-athlete="${esc(a.id)}">Detail</button><button class="primary tiny" data-edit-athlete="${esc(a.id)}">Edit</button><button class="warning tiny" data-reset-parent-password="${esc(a.id)}">Reset Akun</button><button class="danger tiny" data-delete-athlete="${esc(a.id)}">Hapus</button></td>`:''}</tr>`).join('')}
 </tbody></table></div></section>
 ${canManage?`<dialog id="athleteDialog"><form id="athleteForm" class="modal-form"><div class="card-head"><h3 id="athleteDialogTitle">Tambah Atlet</h3><button type="button" class="icon-btn" data-close>✕</button></div>
 <input type="hidden" name="editId"><label>Nama Lengkap<input name="name" required></label><label>Jenis Kelamin<select name="gender" required><option value="">Pilih</option><option>Laki-laki</option><option>Perempuan</option></select></label>
 <label>Tempat Lahir<input name="birthPlace" required></label><label>Tanggal Lahir<input name="birth" type="date" required></label>
 <div id="athleteAuto" class="notice"><b>ID:</b> ${nextAthleteId()} &nbsp; <b>Umur dan KU</b> dihitung otomatis.</div>
 <label>Nomor Telepon Orang Tua<input name="parentWhatsapp" inputmode="tel" placeholder="08xxxxxxxxxx"></label><label>Nama Sekolah<input name="schoolName"></label><label>Catatan Kesehatan<textarea name="healthNotes" rows="3" placeholder="Alergi, kondisi kesehatan, atau catatan khusus"></textarea></label>
 <label>Foto Atlet<input name="photo" type="file" accept="image/*"></label><label>Kartu Keluarga<input name="familyCard" type="file" accept="image/*,application/pdf"></label><label>Akta Kelahiran<input name="birthCertificate" type="file" accept="image/*,application/pdf"></label><label>Bukti Pembayaran Pendaftaran<input name="registrationProof" type="file" accept="image/*,application/pdf"></label>
 <label>Kategori Latihan<select name="trainingCategory"><option>Pemula</option><option>Junior</option><option>Prestasi</option></select></label>
 <fieldset><legend>Kelompok Latihan</legend>${trainingGroupCheckboxes([])}</fieldset><button class="primary">Simpan Data Atlet</button></form></dialog>
 <dialog id="athleteDetailDialog"><div class="modal-form"><div class="card-head"><h3>Detail Data Atlet</h3><button type="button" class="icon-btn" data-close>✕</button></div><div id="athleteDetailContent"></div></div></dialog>`:''}`
}

function coachAthletesPage(){return athleteTable()}
function parentSchedulesPage(){return schedulesManagementPage()}
function parentAnnouncementsPage(){return `<section class="card"><h3>Pengumuman Klub</h3>${announcementRows(50)}</section>`}
function parentSettingsPage(){return `<section class="card"><h3>Pengaturan Orang Tua</h3><p>Login orang tua menggunakan ID Atlet. Password awal juga menggunakan ID Atlet. Setelah login pertama, password wajib diganti menjadi tepat 6 karakter dan hanya boleh huruf atau angka.</p><button class="primary" data-page="parentPassword">Ganti Password</button></section>`}
function settingsPage(){
 return `<div class="settings-grid">
 <section class="card"><h3>Identitas Klub & Logo</h3><form id="settingsForm" class="form-grid">
 <div class="logo-preview">${clubLogo("settings-logo")}</div>
 <label>Ganti Logo Klub<input name="logo" type="file" accept="image/*"></label>
 <small class="hint">Logo baru akan tampil pada halaman login, sidebar Admin, Pelatih, dan Orang Tua.</small>
 <label>Nama Klub<input name="clubName" value="${esc(state.settings.clubName||'AQILAH Swimming Club')}" required></label>
 <label>Nama Pengelola<input name="coachName" value="${esc(state.settings.coachName||'Fahmi Djawas, S.Pd.')}" required></label>
 <button class="primary">Simpan Identitas dan Logo</button></form></section>
 <section class="card"><h3>Ganti Password Admin</h3><p>Password Admin digunakan bersama username Admin, tanpa email.</p><form id="adminPasswordForm" class="form-grid">
 <label>Password Saat Ini<input name="currentPassword" type="password" required autocomplete="current-password"></label>
 <label>Password Baru<input name="newPassword" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" required autocomplete="new-password"></label>
 <label>Ulangi Password Baru<input name="confirmPassword" type="password" minlength="6" maxlength="6" pattern="[A-Za-z0-9]{6}" required autocomplete="new-password"></label>
 <button class="primary">Ganti Password Admin</button><p id="adminPasswordError" class="error"></p></form></section>
 <section class="card system-health-card"><h3>Monitoring, Backup, dan Pemulihan</h3>${(()=>{const h=systemHealth();return `<div class="health-grid"><div><b>Database</b><span>${esc(h.database)}</span></div><div><b>Realtime</b><span>${esc(h.realtime)}</span></div><div><b>Backup Lokal</b><span>${esc(h.localBackup)}</span></div><div><b>Antrean</b><span>${esc(h.pending)}</span></div><div><b>Revisi</b><span>${h.revision}</span></div><div><b>Jurnal Terakhir</b><span>${esc(h.journal)}</span></div></div>`})()}<div class="action-stack recovery-actions"><button class="primary small" id="syncNow">Sinkronkan Sekarang</button><button class="secondary small" id="downloadFullBackup">Download Backup JSON</button><button class="secondary small" id="downloadAuditTrail">Download Audit Trail</button><button class="warning small" id="restoreSafetySnapshot">Pulihkan Snapshot Terakhir</button></div><small class="hint">Pemulihan menggabungkan snapshot dengan data saat ini dan tidak menimpa data unik yang masih ada.</small></section>
 </div>`
}
function pageContent(){if(role==='parent'){if(currentPage==='parentDashboard')return parentDashboard();if(currentPage==='parentPassword')return parentPasswordPage();if(currentPage==='parentProfile')return parentProfile();if(currentPage==='parentTargets')return parentTargetPage();if(currentPage==='parentJournal')return parentJournalPage();if(currentPage==='parentAttendance')return parentAttendancePage();if(currentPage==='parentDryland')return parentDrylandPage();if(currentPage==='parentPackage')return parentPackagePage();if(currentPage==='parentInvoices')return parentInvoicesPage();if(currentPage==='parentPrograms')return parentPrograms();if(currentPage==='parentCompetitions')return parentCompetitionsPage();if(currentPage==='parentSchedules')return parentSchedulesPage();if(currentPage==='parentAnnouncements')return parentAnnouncementsPage();if(currentPage==='parentSettings')return parentSettingsPage();if(currentPage==='parentPassword')return parentPasswordPage();if(currentPage==='parentTimes')return parentTimes();if(currentPage==='parentPayment')return parentPaymentPage();return parentDashboard()}if(role==='coach'){if(currentPage==='coachPassword')return coachPasswordPage();if(currentPage==='coachSettings')return coachSettingsPage();if(currentPage==='coachNotifications')return coachNotificationsPage();if(currentPage==='coachSalaryHistory')return coachSalaryHistoryPage();if(currentPage==='coachTimeRecords')return coachTimeRecords();if(currentPage==='coachDevelopment')return developmentPage();if(currentPage==='coachAthletes')return coachAthletesPage();if(currentPage==='coachAnnouncements')return parentAnnouncementsPage();if(currentPage==='trainingPrograms')return trainingProgramsPage();if(currentPage==='coachAttendance')return attendanceManagementPage();if(currentPage==='coachSchedules')return schedulesManagementPage();return coachDashboard()}if(currentPage==='notifications')return notificationsPage();if(currentPage==='athletes')return athleteTable();if(currentPage==='registrations')return registrationsPage();if(currentPage==='coaches')return coachesPage();if(currentPage==='coachSalaries')return coachSalariesPage();if(currentPage==='development')return developmentPage();if(currentPage==='timeRecords')return timeRecordsPage();if(currentPage==='trainingPrograms')return trainingProgramsPage();if(currentPage==='attendance')return attendanceManagementPage();if(currentPage==='schedules')return schedulesManagementPage();if(currentPage==='payments')return paymentsPage();if(currentPage==='invoices')return invoicesPage();if(currentPage==='competitions')return competitionsPage();if(currentPage==='competitionRegistrations')return competitionRegistrationsPage();if(currentPage==='competitionPayments')return competitionPaymentsPage();if(currentPage==='announcements')return announcementsPage();if(currentPage==='reports')return reportsPage();if(currentPage==='parents')return generic('Portal Orang Tua',state.athletes.slice(0,10));if(currentPage==='settings')return settingsPage();return dashboardPage()}
function bindEvents(){
 document.querySelectorAll('[data-register-competition]').forEach(b=>b.onclick=()=>{
   const event=state.competitions.find(x=>x.id===b.dataset.registerCompetition),a=parentAthlete(),dialog=document.querySelector('#competitionRegistrationDialog'),form=document.querySelector('#competitionRegistrationForm')
   if(!event||!a||!dialog||!form)return
   const draft=state.competitionRegistrations.find(r=>r.athleteId===a.id&&r.competitionId===event.id&&r.status==='draft')
   form.elements.competitionId.value=event.id
   form.elements.parentNote.value=draft?.parentNote||''
   document.querySelector('#competitionRegistrationTitle').textContent=`Daftar ${event.title}`
   document.querySelector('#competitionRaceChoices').innerHTML=competitionRaceOptions().map(r=>`<label class="check-pill"><input type="checkbox" name="races" value="${esc(r)}" ${(draft?.races||[]).includes(r)?'checked':''}><span>${esc(r)}</span></label>`).join('')||'<p>Nomor lomba belum tersedia.</p>'
   const updateTotal=()=>{const count=form.querySelectorAll('[name="races"]:checked').length;document.querySelector('#competitionTotal').textContent=`Total: Rp${Number(count*Number(event.feePerRace||0)).toLocaleString('id-ID')} (${count} nomor)`}
   form.querySelectorAll('[name="races"]').forEach(x=>x.onchange=updateTotal);updateTotal();dialog.showModal()
 })
 document.querySelector('#competitionRegistrationForm')?.addEventListener('submit',async e=>{
   e.preventDefault();const form=e.currentTarget,f=new FormData(form),event=state.competitions.find(x=>x.id===f.get('competitionId')),a=parentAthlete(),action=e.submitter?.value||'draft',races=f.getAll('races')
   if(!event||!a)return
   if(!races.length)return alert('Pilih minimal satu nomor lomba.')
   setFormBusy(form,true,'Mengunggah dan menyimpan...')
   try{
   let row=state.competitionRegistrations.find(r=>r.athleteId===a.id&&r.competitionId===event.id&&r.status==='draft')
   const registrationId=row?.id||`CR-${Date.now()}-${createId()}`
   const proofFile=f.get('proof');let proof=''
   if(proofFile&&proofFile.size)proof=await registrationUpload(proofFile,'competition-payment',`${a.id}/${registrationId}`)
   const effectiveProof=proof||row?.proof||''
   if(action==='submit'&&!effectiveProof)return alert('Bukti pembayaran wajib diunggah sebelum pendaftaran dikirim ke Admin.')
   const data={id:registrationId,athleteId:a.id,athleteName:a.name,competitionId:event.id,competitionTitle:event.title,races,amount:races.length*Number(event.feePerRace||0),proof:effectiveProof,parentNote:String(f.get('parentNote')||''),status:action==='submit'?'submitted':'draft',submittedAt:action==='submit'?new Date().toISOString():(row?.submittedAt||''),updatedAt:new Date().toISOString(),adminNote:row?.adminNote||''}
   if(row)Object.assign(row,data);else state.competitionRegistrations.push(data)
   if(action==='submit')addAdminNotification('competition_payment','Pendaftaran dan Pembayaran Lomba Baru',`${a.name} mendaftar ${event.title} dan mengirim bukti pembayaran.`,'competitionPayments')
   await commitCriticalRecord('competitionRegistrations',data.id);document.querySelector('#competitionRegistrationDialog')?.close();alert(action==='submit'?'Pendaftaran dan pembayaran telah dikirim untuk diverifikasi Admin.':'Draft pendaftaran berhasil disimpan dan belum masuk ke Admin.');render()
   }catch(err){alert(err.message||'Pendaftaran lomba gagal disimpan.')}finally{setFormBusy(form,false)}
 })
 document.querySelectorAll('[data-approve-competition-registration]').forEach(b=>b.onclick=async()=>{const r=state.competitionRegistrations.find(x=>x.id===b.dataset.approveCompetitionRegistration);if(!r)return;r.status='registered';r.adminNote='Pembayaran diterima. Atlet terdaftar.';r.verifiedAt=new Date().toISOString();queueSave();try{await upsertFinanceReference({direction:'income',referenceType:'competition_registration',referenceId:r.id,amount:r.amount,category:'LOMBA',transactionType:'competition_payment',description:`Pembayaran Lomba - ${r.athleteName} - ${r.competitionTitle}`,athleteId:r.athleteId,athleteName:r.athleteName,competitionId:r.competitionId,proofUrl:r.proof,transactionDate:r.verifiedAt});sendPushNotification({target:'parent',athleteId:r.athleteId,title:'Pembayaran Lomba Dikonfirmasi',message:`Pembayaran lomba ${r.competitionTitle} telah dikonfirmasi.`,page:'parentCompetitions',eventId:r.id})}catch(error){console.error('Transaksi pembayaran lomba gagal disinkronkan:',error)}render()})
 document.querySelectorAll('[data-reject-competition-registration]').forEach(b=>b.onclick=()=>{const r=state.competitionRegistrations.find(x=>x.id===b.dataset.rejectCompetitionRegistration);if(!r)return;const note=prompt('Tuliskan alasan penolakan pembayaran:');if(!note)return;r.status='rejected';r.adminNote=note;r.verifiedAt=new Date().toISOString();queueSave();render()})
 document.querySelector('#downloadCompetitionExcel')?.addEventListener('click',()=>{
   const registrations=state.competitionRegistrations.filter(r=>r.status!=='draft')
   if(!registrations.length)return alert('Belum ada data pendaftaran lomba untuk diunduh.')
   const maxRaces=Math.max(1,...registrations.map(r=>(r.races||[]).length))
   const headers=['No.','Nama Lengkap Atlet','Jenis Kelamin','Tanggal Lahir','KU','Nama Perlombaan',...Array.from({length:maxRaces},(_,i)=>`Nomor Lomba ${i+1}`)]
   const escapeXml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
   const rows=registrations.map((r,index)=>{const athlete=state.athletes.find(a=>a.id===r.athleteId)||{};return [index+1,r.athleteName||athlete.name||'',athlete.gender||'',athlete.birth||'',athlete.ageGroup||calcGroup(athlete.birth)||'',r.competitionTitle||'',...Array.from({length:maxRaces},(_,i)=>(r.races||[])[i]||'')]})
   const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Pendaftaran Lomba"><Table>${[headers,...rows].map((row,rowIndex)=>`<Row>${row.map(value=>`<Cell><Data ss:Type="${typeof value==='number'?'Number':'String'}">${escapeXml(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`
   const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'})
   const eventNames=[...new Set(registrations.map(r=>r.competitionTitle).filter(Boolean))],safeName=(eventNames.length===1?eventNames[0]:'Semua Event').replace(/[\/:*?"<>|]+/g,'-').slice(0,60)
   saveDownloadFile(blob,`Pendaftaran-Lomba-${safeName}.xls`,'application/vnd.ms-excel')
 })
 document.querySelectorAll('[data-preview-competition-proof]').forEach(b=>b.onclick=()=>{const record=state.competitionRegistrations.find(r=>r.id===b.dataset.previewCompetitionProof);if(!record?.proof)return alert('Bukti pembayaran tidak tersedia.');const dialog=document.querySelector('#competitionProofPreviewDialog'),content=document.querySelector('#competitionProofPreviewContent'),link=document.querySelector('#competitionProofDownloadLink'),meta=document.querySelector('#competitionProofPreviewMeta');const proof=record.proof,isPdf=/^data:application\/pdf/i.test(proof)||/\.pdf(?:$|[?#])/i.test(proof);content.innerHTML=isPdf?`<iframe src="${proof}" title="Bukti pembayaran ${esc(record.athleteName)}"></iframe>`:`<img src="${proof}" alt="Bukti pembayaran ${esc(record.athleteName)}">`;meta.textContent=`${record.athleteName} — ${record.competitionTitle}`;link.href=proof;link.download=`Bukti-Pembayaran-${String(record.athleteName||'Atlet').replace(/[^A-Za-z0-9_-]+/g,'-')}`;dialog?.showModal()})
 const navigateToPage=(page)=>{
 const drawer=document.querySelector('.sidebar');
 const backdrop=document.querySelector('.sidebar-backdrop');
 drawer?.classList.remove('show');
 backdrop?.classList.remove('show');
 document.body.classList.remove('mobile-menu-open');
 document.documentElement.classList.remove('mobile-menu-open');
 currentPage=page;
 persistActiveSession();
 render();
 requestAnimationFrame(()=>{
  document.querySelector('.sidebar')?.classList.remove('show');
  document.querySelector('.sidebar-backdrop')?.classList.remove('show');
  document.body.classList.remove('mobile-menu-open');
  document.documentElement.classList.remove('mobile-menu-open');
  window.scrollTo({top:0,left:0,behavior:'auto'});
  document.querySelector('.content')?.scrollTo?.({top:0,left:0,behavior:'auto'});
 });
};
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=(event)=>{event.preventDefault();event.stopPropagation();navigateToPage(b.dataset.page)});document.querySelectorAll('table').forEach(table=>{const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());table.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,index)=>{if(cell.tagName==='TD')cell.dataset.label=labels[index]||''}))});
 document.querySelectorAll('[data-open-notification]').forEach(b=>b.onclick=async()=>{const n=state.notifications.find(x=>x.id===b.dataset.openNotification);if(n){n.read=true;n.readAt=new Date().toISOString();currentPage=n.deepLink||n.page||n.target||'dashboard';try{await commitCriticalRecord('notifications',n.id)}catch(error){console.error('Notifikasi gagal diperbarui:',error)}render()}})
 document.querySelector('#markAllRead')?.addEventListener('click',async()=>{const changed=state.notifications.filter(n=>(n.notificationAudience||n.recipientRole||'admin')==='admin'&&!n.read);changed.forEach(n=>{n.read=true;n.readAt=new Date().toISOString()});await Promise.allSettled(changed.map(n=>commitCriticalRecord('notifications',n.id)));render()})
 document.querySelector('#deleteReadNotifications')?.addEventListener('click',async()=>{const ids=state.notifications.filter(n=>(n.notificationAudience||n.recipientRole||'admin')==='admin'&&n.read).map(n=>n.id);for(const id of ids){try{await deleteDedicatedSafely('notifications',id)}catch(error){console.error(`Notifikasi ${id} gagal ditandai terhapus:`,error)}}addAudit('Bersihkan','notifications','','Menandai notifikasi yang sudah dibaca');render()})
 document.querySelector('#syncNow')?.addEventListener('click',async()=>{syncStatus='Sinkronisasi manual dimulai...';updateSync();pendingRemoteSave=true;await saveRemote();render()})
 document.querySelector('#downloadFullBackup')?.addEventListener('click',()=>{addAudit('Download Backup','system','','Backup JSON lengkap');downloadJsonFile({exportedAt:new Date().toISOString(),clubId:CLUB_ID,payload:state},`AQILAH-BACKUP-${new Date().toISOString().slice(0,10)}.json`)})
 document.querySelector('#downloadAuditTrail')?.addEventListener('click',()=>downloadJsonFile({exportedAt:new Date().toISOString(),auditTrail:state.auditTrail||[]},`AQILAH-AUDIT-${new Date().toISOString().slice(0,10)}.json`))
 document.querySelector('#restoreSafetySnapshot')?.addEventListener('click',()=>{if(!confirm('Pulihkan snapshot pengaman lokal terbaru? Data akan digabungkan, bukan ditimpa.'))return;try{restoreLatestSafetySnapshot();render();alert('Snapshot berhasil dipulihkan dan sedang disinkronkan.')}catch(error){alert(error.message)}})



 document.querySelector('#addAnnouncement')?.addEventListener('click',()=>{const f=document.querySelector('#announcementForm');f?.reset();if(f)f.elements.editId.value='';const t=document.querySelector('#announcementDialogTitle');if(t)t.textContent='Tambah Pengumuman';document.querySelector('#announcementDialog')?.showModal()})
 document.querySelector('#announcementForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),editId=String(f.get('editId')||''),existing=state.announcements.find(a=>a.id===editId);const data={id:existing?.id||createId(),title:String(f.get('title')||'').trim(),body:String(f.get('body')||'').trim(),date:new Date().toISOString().slice(0,10)};if(existing)Object.assign(existing,data);else state.announcements.push(data);try{await commitCriticalRecord('announcements',data.id);if(!existing)sendPushNotification({target:'all',title:data.title,message:data.body,page:'announcements',eventId:data.id});document.querySelector('#announcementDialog')?.close();render()}catch(error){console.error('Pengumuman gagal disimpan:',error);alert(error.message||'Pengumuman belum tersimpan di Supabase.')}})
 document.querySelectorAll('[data-edit-announcement]').forEach(b=>b.onclick=()=>{const a=state.announcements.find(x=>x.id===b.dataset.editAnnouncement),f=document.querySelector('#announcementForm');if(!a||!f)return;f.elements.editId.value=a.id;f.elements.title.value=a.title||'';f.elements.body.value=a.body||'';document.querySelector('#announcementDialogTitle').textContent='Edit Pengumuman';document.querySelector('#announcementDialog')?.showModal()})
 document.querySelectorAll('[data-delete-announcement]').forEach(b=>b.onclick=async()=>{if(confirm('Hapus pengumuman ini?')){try{await deleteDedicatedSafely('announcements',b.dataset.deleteAnnouncement)}catch(error){console.error('Pengumuman gagal ditandai terhapus:',error);alert(error.message||'Pengumuman belum terhapus di Supabase.')}}})
 document.querySelector('#addCompetition')?.addEventListener('click',()=>document.querySelector('#competitionDialog')?.showModal())
 document.querySelector('#competitionForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   if(role!=='admin')return
   const f=new FormData(e.currentTarget)
   const flyerFile=f.get('flyer')
   const flyer=flyerFile&&flyerFile.size?await imageData(flyerFile,1200):''
   const competition={
     id:createId(),
     title:String(f.get('title')||'').trim(),
     eventDate:String(f.get('eventDate')||''),
     location:String(f.get('location')||'').trim(),
     registrationDeadline:String(f.get('registrationDeadline')||''),
     organizer:String(f.get('organizer')||'').trim(),
     feePerRace:Number(f.get('feePerRace')||0),
     raceOptions:competitionRaceOptions(),
     description:String(f.get('description')||'').trim(),
     flyer,
     createdAt:new Date().toISOString()
   }
   state.competitions.push(competition)
   try{
     await commitCriticalRecord('competitions',competition.id)
     addAdminNotification('competition','Event perlombaan baru',competition.title,'competitions')
     sendPushNotification({target:'all',title:'Informasi Lomba Baru',message:`${competition.title} telah ditambahkan. Silakan lihat detailnya.`,page:'parentCompetitions',deepLinkParent:'parentCompetitions',deepLinkCoach:'coachDashboard',type:'competition_created',referenceType:'competition',eventId:competition.id})
     document.querySelector('#competitionDialog')?.close();render()
   }catch(error){state.competitions=state.competitions.filter(item=>item.id!==competition.id);saveLocal();console.error('Supabase asc_competitions gagal membuat event:',error);alert(error.message||'Event belum tersimpan di Supabase.')}
  })
 document.querySelectorAll('[data-delete-competition]').forEach(b=>b.addEventListener('click',async()=>{
   if(role!=='admin')return
   if(!confirm('Hapus event perlombaan ini?'))return
   try{await deleteDedicatedSafely('competitions',b.dataset.deleteCompetition)}catch(error){console.error('Supabase asc_competitions gagal menghapus event:',error);alert(error.message||'Event belum dihapus dari Supabase.')}
 }))
 document.querySelectorAll('[data-view-flyer]').forEach(b=>b.onclick=()=>{
   const event=state.competitions.find(e=>e.id===b.dataset.viewFlyer)
   if(!event?.flyer)return
   const dialog=document.querySelector('#flyerPreviewDialog')
   const image=document.querySelector('#flyerPreviewImage')
   image.src=event.flyer
   image.alt=`Flyer ${event.title}`
   dialog?.showModal()
 })
  document.querySelector('#attendanceForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   if(!['admin','coach'].includes(role))return
   const f=new FormData(e.currentTarget)
   const athleteId=String(f.get('athleteId')||'')
   const date=String(f.get('date')||'')
   const existing=state.attendance.find(r=>r.athleteId===athleteId&&r.date===date)
   const row={id:existing?.id||createId(),athleteId,date,status:String(f.get('status')||'Hadir'),note:String(f.get('note')||''),updatedAt:new Date().toISOString(),updatedBy:role}
   if(existing)Object.assign(existing,row);else state.attendance.push(row)
    try{await commitCriticalRecord('attendance',row.id);render()}catch(error){console.error('Absensi gagal disimpan:',error);alert(error.message||'Absensi belum berhasil disimpan ke Supabase.')}
  })
  document.querySelectorAll('[data-delete-attendance]').forEach(b=>b.onclick=async()=>{
    if(!['admin','coach'].includes(role))return
    try{await deleteAttendanceSafely(b.dataset.deleteAttendance)}catch(error){console.error('Penghapusan satu record absensi gagal:',error);alert(`Perubahan tersimpan di perangkat, tetapi Supabase gagal: ${error.message||error}`)}
 })
 document.querySelector('#trainingScheduleForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   if(!['admin','coach'].includes(role))return
   const f=new FormData(e.currentTarget)
   const schedule={
     id:createId(),
     day:String(f.get('day')||''),
     time:String(f.get('time')||''),
     location:String(f.get('location')||'').trim(),
     group:String(f.get('group')||'').trim(),
     coachId:String(f.get('coachId')||''),
     updatedAt:new Date().toISOString(),
     updatedBy:role
   }
   state.schedules.push(schedule)
   try{await commitCriticalRecord('schedules',schedule.id);sendPushNotification({target:'all',title:'Jadwal Latihan Diperbarui',message:'Jadwal latihan telah diperbarui.',page:'parentSchedules',deepLinkParent:'parentSchedules',deepLinkCoach:'coachSchedules',type:'schedule_updated',referenceType:'schedule',eventId:schedule.id});render()}catch(error){console.error('Jadwal gagal disimpan:',error);alert(error.message||'Jadwal belum tersimpan di Supabase.')}
 })
 document.querySelectorAll('[data-delete-schedule]').forEach(b=>b.onclick=async()=>{
   if(!['admin','coach'].includes(role))return
   try{await deleteDedicatedSafely('schedules',b.dataset.deleteSchedule)}catch(error){console.error('Jadwal gagal ditandai terhapus:',error);alert(error.message||'Jadwal belum terhapus di Supabase.')}
 })
  document.querySelector('#parentPhotoForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   if(role!=='parent')return
   const athlete=parentAthlete(),form=e.currentTarget,error=document.querySelector('#parentPhotoError')
   const file=new FormData(form).get('photo')
   if(error)error.textContent=''
   if(!athlete||!file||!file.size){if(error)error.textContent='Silakan pilih foto terlebih dahulu.';return}
   const button=form.querySelector('button[type=submit]');if(button){button.disabled=true;button.textContent='Mengunggah...'}
   try{athlete.photo=await imageData(file,500,'parent-profile');queueSave();alert('Foto atlet berhasil diperbarui.');render()}
   catch(err){if(error)error.textContent=err.message||'Foto gagal diunggah.';else alert(err.message||'Foto gagal diunggah.')}
   finally{if(button){button.disabled=false;button.textContent='Simpan Foto'}}
 })
 document.querySelectorAll('[data-payment-tab]').forEach(b=>b.onclick=()=>{
   document.querySelectorAll('[data-payment-tab]').forEach(x=>x.classList.toggle('active',x===b))
   const type=b.dataset.paymentTab,form=document.querySelector('#parentPaymentForm')
   if(!form)return
   form.elements.paymentType.value=type
   document.querySelector('#sppFields').hidden=type!=='spp'
   document.querySelector('#competitionFields').hidden=type!=='competition'
 })
 document.querySelector('#parentPaymentForm select[name="invoiceId"]')?.addEventListener('change',e=>{
   const inv=state.invoices.find(i=>i.id===e.target.value),form=document.querySelector('#parentPaymentForm')
   if(!inv)return
   document.querySelector(`[data-payment-tab="${inv.type}"]`)?.click()
   form.elements.amount.value=inv.amount
   if(inv.type==='competition')form.elements.competitionName.value=inv.title
 })
 document.querySelector('#parentPaymentForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   const f=new FormData(e.currentTarget),a=parentAthlete(),type=String(f.get('paymentType')||'spp'),error=document.querySelector('#paymentError')
   try{
     setFormBusy(e.currentTarget,true,'Mengunggah dan menyimpan...')
     const paymentId=`PAY-${Date.now()}-${createId()}`
     const proof=await registrationUpload(f.get('proof'),'payment',`${a.id}/${paymentId}`)
     const p={id:paymentId,athleteId:a.id,athleteName:a.name,paymentType:type,invoiceId:String(f.get('invoiceId')||''),month:String(f.get('month')||''),competitionName:String(f.get('competitionName')||''),competitionLevel:String(f.get('competitionLevel')||''),amount:Number(f.get('amount')),proof,note:String(f.get('note')||''),submittedAt:new Date().toISOString(),status:'pending'}
     state.payments.push(p)
     addAdminNotification(type==='competition'?'competition_payment':'spp_payment',type==='competition'?'Pembayaran Lomba Baru':'Pembayaran SPP Baru',type==='competition'?`${a.name} mengirim pembayaran lomba ${p.competitionName||''}.`:`${a.name} mengirim bukti pembayaran SPP ${p.month||''}.`,type==='competition'?'competitionPayments':'payments')
     await commitCriticalRecord('payments',p.id);alert('Bukti pembayaran dikirim dan sudah tersimpan di server.');render()
   }catch(err){error.textContent=err.message||'Pembayaran gagal dikirim.'}
   finally{setFormBusy(e.currentTarget,false)}
 })

  document.querySelector('#downloadPaymentsExcel')?.addEventListener('click',()=>{
  const rows=state.payments.slice().sort((a,b)=>String(b.submittedAt||'').localeCompare(String(a.submittedAt||''))).map((p,i)=>[i+1,p.athleteId||'',p.athleteName||'',paymentTypeLabel(p.paymentType),p.paymentType==='competition'?(p.competitionName||'Lomba'):(p.month||'SPP'),Number(p.amount||0),paymentStatusLabel(p.status),new Date(p.submittedAt||Date.now()).toLocaleString('id-ID'),p.note||''])
  downloadXmlExcel(`Pembayaran-ASC-${new Date().toISOString().slice(0,10)}.xls`,'Pembayaran',['No','ID Atlet','Nama Atlet','Jenis','Keterangan','Nominal','Status','Tanggal','Catatan'],rows)
 })
 document.querySelectorAll('[data-preview-payment-proof]').forEach(b=>b.onclick=()=>{
  const p=state.payments.find(x=>x.id===b.dataset.previewPaymentProof);if(!p?.proof)return alert('Bukti pembayaran tidak tersedia.')
  const d=document.querySelector('#paymentProofDialog'),c=document.querySelector('#paymentProofContent'),m=document.querySelector('#paymentProofMeta'),a=document.querySelector('#paymentProofDownload'),isPdf=/^data:application\/pdf/i.test(p.proof)||/\.pdf(?:$|[?#])/i.test(p.proof)
  c.innerHTML=isPdf?`<iframe src="${p.proof}" title="Bukti pembayaran"></iframe>`:`<img src="${p.proof}" alt="Bukti pembayaran">`;m.textContent=`${p.athleteName} — ${paymentTypeLabel(p.paymentType)}`;a.href=p.proof;a.download=`Bukti-${String(p.athleteName||'Atlet').replace(/[^A-Za-z0-9_-]+/g,'-')}`;d?.showModal()
 })
 document.querySelector('#downloadInvoicesExcel')?.addEventListener('click',()=>{
  const rows=state.invoices.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map((i,n)=>[n+1,i.athleteId||'',i.athleteName||'',i.type==='competition'?'Lomba':'SPP',i.title||'',Number(i.amount||0),i.dueDate||'',invoiceStatusLabel(i.status),i.description||''])
  downloadXmlExcel(`Tagihan-ASC-${new Date().toISOString().slice(0,10)}.xls`,'Tagihan',['No','ID Atlet','Nama Atlet','Jenis','Judul','Nominal','Jatuh Tempo','Status','Keterangan'],rows)
 })
 document.querySelector('#downloadSalariesExcel')?.addEventListener('click',()=>{
  const rows=state.coachSalaries.slice().sort((a,b)=>String(b.paidAt||'').localeCompare(String(a.paidAt||''))).map((s,n)=>[n+1,s.coachId||'',s.coachName||'',s.period||'',Number(s.amount||0),formatSalaryDate(s.paidAt),formatSalaryTime(s.paidAt),salaryStatusLabel(s.status),s.note||''])
  downloadXmlExcel(`Gaji-Pelatih-ASC-${new Date().toISOString().slice(0,10)}.xls`,'Gaji Pelatih',['No','ID Pelatih','Nama Pelatih','Periode','Nominal','Tanggal','Waktu','Status','Keterangan'],rows)
 })
 document.querySelectorAll('[data-approve-payment]').forEach(b=>b.onclick=async()=>{
   const p=state.payments.find(x=>x.id===b.dataset.approvePayment)
   if(p){p.status='approved';p.approvedAt=new Date().toISOString();if(p.invoiceId){const inv=state.invoices.find(i=>i.id===p.invoiceId);if(inv)inv.status='paid'}try{const isCompetition=p.paymentType==='competition',title=isCompetition?'Pembayaran Lomba Dikonfirmasi':'Pembayaran SPP Dikonfirmasi',message=isCompetition?`Pembayaran lomba ${p.competitionName||''} telah dikonfirmasi.`:`Pembayaran SPP ${p.month||''} telah dikonfirmasi.`,deepLink=isCompetition?'parentCompetitions':'parentPayment';await commitCriticalRecord('payments',p.id);await upsertFinanceReference({direction:'income',referenceType:'payment',referenceId:p.id,amount:p.amount,category:isCompetition?'Pembayaran Lomba':'Pembayaran SPP',transactionType:p.paymentType,description:`${paymentTypeLabel(p.paymentType)} - ${p.athleteName} - ${p.month||p.competitionName||''}`,athleteId:p.athleteId,athleteName:p.athleteName,paymentId:p.id,proofUrl:p.proof,transactionDate:p.approvedAt});await upsertTargetedNotification({recipientRole:'parent',recipientId:p.athleteId,athleteId:p.athleteId,title,message,type:'payment_approved',referenceType:'payment',referenceId:p.id,page:deepLink});sendPushNotification({target:'parent',athleteId:p.athleteId,title,message,page:deepLink,type:'payment_approved',referenceType:'payment',eventId:p.id});render()}catch(error){console.error('Pembayaran gagal diperbarui:',error);alert(error.message||'Pembayaran belum diperbarui di Supabase.')}}
 })
 document.querySelectorAll('[data-reject-payment]').forEach(b=>b.onclick=async()=>{
   const p=state.payments.find(x=>x.id===b.dataset.rejectPayment)
   if(p&&confirm('Tolak pembayaran ini?')){p.status='rejected';p.rejectedAt=new Date().toISOString();try{await commitCriticalRecord('payments',p.id);await deactivateFinanceReference('income','payment',p.id);sendPushNotification({target:'parent',athleteId:p.athleteId,title:'Pembayaran Ditolak',message:'Silakan periksa kembali bukti pembayaran.',page:'parentPayment',eventId:p.id});render()}catch(error){console.error('Pembayaran gagal diperbarui:',error);alert(error.message||'Pembayaran belum diperbarui di Supabase.')}}
 })
 document.querySelector('#addCoachSalary')?.addEventListener('click',()=>document.querySelector('#coachSalaryDialog').showModal())
 document.querySelector('#coachSalaryForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   const f=new FormData(e.currentTarget),coach=state.coaches.find(c=>c.id===f.get('coachId')),error=document.querySelector('#coachSalaryError')
   try{
     setFormBusy(e.currentTarget,true,'Mengunggah dan menyimpan...')
     if(!coach)throw new Error('Pelatih tidak ditemukan.')
     const salaryId=`SAL-${Date.now()}-${createId()}`
     const proof=await registrationUpload(f.get('proof'),'coach-salary',`${coach.id}/${salaryId}`)
     const salary={id:salaryId,coachId:coach.id,coachName:coach.name,period:String(f.get('period')),amount:Number(f.get('amount')),paidAt:new Date().toISOString(),proof,note:String(f.get('note')||''),status:'paid',createdAt:new Date().toISOString()}
     state.coachSalaries.push(salary)
     await commitCriticalRecord('coachSalaries',salary.id)
     await upsertFinanceReference({direction:'expense',referenceType:'coach_salary',referenceId:salary.id,amount:salary.amount,category:'GAJI',transactionType:'coach_salary',description:`Pembayaran Gaji Pelatih - ${coach.name} - ${salary.period}`,coachId:coach.id,coachName:coach.name,proofUrl:salary.proof,transactionDate:salary.paidAt})
     const salaryMessage=`Gaji periode ${salary.period} sebesar Rp${salary.amount.toLocaleString('id-ID')} telah dibayarkan oleh Admin.`
     await upsertTargetedNotification({recipientRole:'coach',recipientId:coach.id,title:'Gaji Pelatih Telah Dibayarkan',message:salaryMessage,type:'coach_salary_paid',referenceType:'coach_salary',referenceId:salary.id,page:'coachSalaryHistory'})
     sendPushNotification({target:'coach',coachId:coach.id,title:'Gaji Pelatih Telah Dibayarkan',message:salaryMessage,page:'coachSalaryHistory',eventId:salary.id,inApp:false})
     alert('Pembayaran gaji sudah tersimpan di server dan notifikasi dibuat untuk pelatih.');document.querySelector('#coachSalaryDialog').close();render()
   }catch(err){error.textContent=err.message||'Pembayaran gaji gagal disimpan.'}
   finally{setFormBusy(e.currentTarget,false)}
 })
 document.querySelectorAll('[data-delete-salary]').forEach(b=>b.onclick=async()=>{if(!confirm('Batalkan pembayaran gaji ini? Data tidak akan dihapus permanen.'))return;const salary=state.coachSalaries.find(s=>s.id===b.dataset.deleteSalary);if(!salary)return;salary.status='cancelled';salary.cancelledAt=new Date().toISOString();queueSave();try{await deactivateFinanceReference('expense','coach_salary',salary.id);const notification=state.coachNotifications.find(n=>n.referenceType==='coach_salary'&&n.referenceId===salary.id);if(notification)await deleteDedicatedSafely('coachNotifications',notification.id)}catch(error){console.error('Pembatalan transaksi gaji belum lengkap:',error)}render()})
 document.querySelector('#markCoachNotificationsRead')?.addEventListener('click',()=>{const c=currentCoach();state.coachNotifications.forEach(n=>{if(n.coachId===c.id&&!n.read){n.read=true;n.readAt=new Date().toISOString();persistDedicatedSoon('coachNotifications',n.id)}});render()})
 document.querySelectorAll('[data-coach-notification]').forEach(el=>el.onclick=()=>{const n=state.coachNotifications.find(x=>x.id===el.dataset.coachNotification);if(n){n.read=true;n.readAt=new Date().toISOString();currentPage=n.page||'coachSalaryHistory';persistDedicatedSoon('coachNotifications',n.id);render()}})

 document.querySelector('#addInvoice')?.addEventListener('click',()=>document.querySelector('#invoiceDialog').showModal())
 document.querySelector('#invoiceForm')?.addEventListener('submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),a=state.athletes.find(x=>x.id===f.get('athleteId'))
   const invoice={id:nextInvoiceId(),athleteId:a.id,athleteName:a.name,type:String(f.get('type')),title:String(f.get('title')),amount:Number(f.get('amount')),dueDate:String(f.get('dueDate')||''),description:String(f.get('description')||''),status:'unpaid',createdAt:new Date().toISOString()}
   state.invoices.push(invoice)
   try{await commitCriticalRecord('invoices',invoice.id);alert('Tagihan berhasil dibuat.');document.querySelector('#invoiceDialog').close();render()}catch(error){state.invoices=state.invoices.filter(item=>item.id!==invoice.id);saveLocal();console.error('Supabase asc_invoices gagal membuat tagihan:',error);alert(error.message||'Tagihan belum tersimpan di Supabase.')}
  })
 document.querySelectorAll('[data-cancel-invoice]').forEach(b=>b.onclick=async()=>{const i=state.invoices.find(x=>x.id===b.dataset.cancelInvoice);if(i&&confirm('Batalkan tagihan ini?')){const previous=i.status;i.status='cancelled';try{await commitCriticalRecord('invoices',i.id);render()}catch(error){i.status=previous;console.error('Supabase asc_invoices gagal membatalkan tagihan:',error);alert(error.message||'Tagihan belum dibatalkan di Supabase.')}}})
 document.querySelectorAll('[data-delete-invoice]').forEach(b=>b.onclick=async()=>{if(!confirm('Hapus tagihan ini?'))return;try{await deleteDedicatedSafely('invoices',b.dataset.deleteInvoice)}catch(error){console.error('Supabase asc_invoices gagal menghapus tagihan:',error);alert(error.message||'Tagihan belum dihapus dari Supabase.')}})
 document.querySelectorAll('[data-pay-invoice]').forEach(b=>b.onclick=()=>{const id=b.dataset.payInvoice;currentPage='parentPayment';render();setTimeout(()=>{const s=document.querySelector('#parentPaymentForm select[name="invoiceId"]');if(s){s.value=id;s.dispatchEvent(new Event('change'))}},0)})

 document.querySelector('#openReschedule')?.addEventListener('click',()=>document.querySelector('#rescheduleDialog').showModal())
 document.querySelector('#rescheduleForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),a=parentAthlete();const req={id:`RSC-${Date.now()}`,athleteId:a.id,athleteName:a.name,reason:String(f.get('reason')),preferredDate:String(f.get('preferredDate')||''),note:String(f.get('note')||''),status:'Menunggu Konfirmasi',createdAt:new Date().toISOString()};state.rescheduleRequests.push(req);addAdminNotification('reschedule','Permintaan jadwal pengganti',`${a.name} mengajukan jadwal pengganti karena ${req.reason}.`,'attendance');queueSave();alert('Permintaan jadwal pengganti dikirim ke admin.');render()})
 document.querySelector('#toggleReminder')?.addEventListener('click',async()=>{const a=parentAthlete();state.parentReminders[a.id]=!state.parentReminders[a.id];if(state.parentReminders[a.id]&&'Notification'in window&&Notification.permission==='default')await Notification.requestPermission();queueSave();render()})
 document.querySelector('#targetForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),a=state.athletes.find(x=>x.id===f.get('athleteId')),c=currentCoach();state.weeklyTargets.push({id:createId(),athleteId:a.id,mission:String(f.get('mission')),status:String(f.get('status')),note:String(f.get('note')||''),coachName:c?.name||'Admin',updatedAt:new Date().toISOString()});queueSave();alert('Target mingguan disimpan.');e.currentTarget.reset()})
 document.querySelector('#journalForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),a=state.athletes.find(x=>x.id===f.get('athleteId')),c=currentCoach();const yes=String(f.get('skills')||'').split(',').map(s=>s.trim()).filter(Boolean).map(name=>({name,done:true}));const no=String(f.get('notSkills')||'').split(',').map(s=>s.trim()).filter(Boolean).map(name=>({name,done:false}));const strokeMastery={};['Gaya Bebas','Gaya Dada','Gaya Punggung','Gaya Kupu-kupu'].forEach(s=>strokeMastery[s]=String(f.get(s)));state.skillJournals.push({id:createId(),athleteId:a.id,basicSkills:[...yes,...no],strokeMastery,coachNote:String(f.get('coachNote')||''),coachName:c?.name||'Admin',updatedAt:new Date().toISOString()});queueSave();alert('Jurnal perkembangan disimpan.');e.currentTarget.reset()})
 document.querySelector('#drylandForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),a=state.athletes.find(x=>x.id===f.get('athleteId'));state.drylandTasks.push({id:createId(),athleteId:a.id,title:String(f.get('title')),description:String(f.get('description')),videoUrl:String(f.get('videoUrl')||''),duration:String(f.get('duration')||'±1 menit'),date:new Date().toISOString()});queueSave();alert('Tugas dryland disimpan.');e.currentTarget.reset()})
 document.querySelector('#packageForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),a=state.athletes.find(x=>x.id===f.get('athleteId'));state.athletePackages.push({id:createId(),athleteId:a.id,packageName:String(f.get('packageName')),totalSessions:Number(f.get('totalSessions')),remainingSessions:Number(f.get('remainingSessions')),expiryDate:String(f.get('expiryDate')),updatedAt:new Date().toISOString()});queueSave();alert('Paket atlet disimpan.');e.currentTarget.reset()})


 document.querySelectorAll('[data-preview-document]').forEach(b=>b.onclick=()=>{
   const r=state.pendingRegistrations.find(x=>x.id===b.dataset.registrationId)
   const field=b.dataset.previewDocument,value=r?.[field]
   if(!value)return alert('Berkas tidak tersedia.')
   const title=field==='certificate'?'Preview Akta Kelahiran':'Preview Bukti Pembayaran'
   const box=document.querySelector('#documentPreviewContent'),link=document.querySelector('#documentDownloadLink')
   if(!box||!link)return
   document.querySelector('#documentPreviewTitle').textContent=title
   const isPdf=String(value).startsWith('data:application/pdf')
   box.innerHTML=isPdf?`<iframe src="${value}" title="${title}"></iframe>`:`<img src="${value}" alt="${title}">`
   link.href=value;link.download=field==='certificate'?(r.certificateName||'akta-kelahiran'):(r.paymentProofName||'bukti-pembayaran')
   document.querySelector('#documentPreviewDialog')?.showModal()
 })
 document.querySelectorAll('[data-preview-proof]').forEach(b=>b.onclick=()=>{
   const source=b.dataset.previewProof,record=source==='salary'?state.coachSalaries.find(x=>x.id===b.dataset.recordId):state.payments.find(x=>x.id===b.dataset.recordId)
   if(!record?.proof)return alert('Bukti pembayaran tidak tersedia.')
   let dialog=document.querySelector('#proofPreviewDialog')
   if(!dialog){dialog=document.createElement('dialog');dialog.id='proofPreviewDialog';dialog.className='document-preview-dialog';dialog.innerHTML='<div class="modal-form document-preview-shell"><div class="card-head"><h3>Preview Bukti Pembayaran</h3><button type="button" class="icon-btn proof-close">✕</button></div><div class="document-preview-content" id="proofPreviewContent"></div><a id="proofDownloadLink" class="primary inline-button" download="bukti-pembayaran">Download Bukti</a></div>';document.body.appendChild(dialog);dialog.querySelector('.proof-close').onclick=()=>dialog.close()}
   const box=dialog.querySelector('#proofPreviewContent'),link=dialog.querySelector('#proofDownloadLink'),value=record.proof,isPdf=String(value).startsWith('data:application/pdf')
   box.innerHTML=isPdf?`<iframe src="${value}" title="Bukti Pembayaran"></iframe>`:`<img src="${value}" alt="Bukti Pembayaran">`;link.href=value;dialog.showModal()
 })

 document.querySelector('#logoutBtn')?.addEventListener('click',async()=>{if(unsubscribeRealtime){supabase.removeChannel(unsubscribeRealtime);unsubscribeRealtime=null}await clearCurrentPushDevice();clearActiveSession();role='';parentAthleteId='';coachId='';currentPage='dashboard';syncStatus='Siap';document.body.classList.remove('mobile-menu-open');document.documentElement.classList.remove('mobile-menu-open');render()});const sidebar=document.querySelector('.sidebar');const sidebarBackdrop=document.querySelector('.sidebar-backdrop');const closeMobileSidebar=()=>{sidebar?.classList.remove('show');sidebarBackdrop?.classList.remove('show');document.body.classList.remove('mobile-menu-open');document.documentElement.classList.remove('mobile-menu-open')};const openMobileSidebar=()=>{sidebar?.classList.add('show');sidebarBackdrop?.classList.add('show');document.body.classList.add('mobile-menu-open');document.documentElement.classList.add('mobile-menu-open')};const toggleMobileSidebar=()=>sidebar?.classList.contains('show')?closeMobileSidebar():openMobileSidebar();document.querySelector('#menuBtn')?.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();toggleMobileSidebar()});document.querySelector('#moreNavBtn')?.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();toggleMobileSidebar()});sidebarBackdrop?.addEventListener('click',closeMobileSidebar);if(!window.__ascResizeHandlerBound){window.__ascResizeHandlerBound=true;window.addEventListener('resize',()=>{const mobileLayout=window.matchMedia('(max-width:767px), (min-width:768px) and (max-width:1100px) and (orientation:portrait), (orientation:landscape) and (max-width:1100px) and (max-height:650px)').matches;if(!mobileLayout){document.querySelector('.sidebar')?.classList.remove('show');document.querySelector('.sidebar-backdrop')?.classList.remove('show');document.body.classList.remove('mobile-menu-open');document.documentElement.classList.remove('mobile-menu-open')}})}document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{const d=b.closest('dialog');d?.close();setTimeout(finishDeferredRemoteRender,0)});document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>setTimeout(finishDeferredRemoteRender,0)))
 document.querySelector('#parentProfileForm')?.addEventListener('submit',async e=>{
   e.preventDefault();if(role!=='parent')return
   const athlete=parentAthlete(),form=e.currentTarget,f=new FormData(form),error=document.querySelector('#parentProfileError')
   try{
     setFormBusy(form,true,'Mengunggah dan menyimpan...')
     const upload=async(name,type,current)=>{const file=f.get(name);return file?.size?registrationUpload(file,type,`${athlete.id}/profile`):current||''}
     athlete.parentPhone=String(f.get('parentPhone')||'').trim();athlete.parentWhatsapp=athlete.parentPhone;athlete.schoolName=String(f.get('schoolName')||'').trim()
     athlete.familyCard=await upload('familyCard','family-card',athlete.familyCard)
     athlete.birthCertificate=await upload('birthCertificate','birth-certificate',athlete.birthCertificate)
     const photo=f.get('photo');if(photo?.size)athlete.photo=await imageData(photo,500,'parent-profile')
     athlete.profileUpdatedAt=new Date().toISOString();athlete.profileUpdatedBy=`parent:${athlete.id}`
     await commitCriticalRecord('athletes',athlete.id);alert('Profil atlet berhasil diperbarui dan langsung tersinkron ke Admin.');render()
   }catch(err){console.error('Supabase profil atlet gagal diperbarui:',err);if(error)error.textContent=err.message||'Profil gagal disimpan.'}
   finally{setFormBusy(form,false)}
 })
 document.querySelectorAll('[data-edit-registration]').forEach(b=>b.onclick=()=>{
   const r=state.pendingRegistrations.find(x=>x.id===b.dataset.editRegistration),d=document.querySelector('#registrationEditDialog'),f=document.querySelector('#registrationEditForm')
   if(!r||!d||!f)return
   f.elements.editId.value=r.id;f.elements.name.value=r.name||'';f.elements.gender.value=r.gender||'Laki-Laki';f.elements.birth.value=r.birth||'';f.elements.parentWhatsapp.value=r.parentWhatsapp||'';f.elements.classCategory.value=r.classCategory||'Group';f.elements.package.value=r.package||'Paket 1';f.elements.healthNote.value=r.healthNote||'';d.showModal()
 })
 document.querySelector('#registrationEditForm')?.addEventListener('submit',async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),r=state.pendingRegistrations.find(x=>x.id===String(f.get('editId')))
   if(!r)return
   r.name=String(f.get('name')||'').trim();r.gender=String(f.get('gender')||'');r.birth=String(f.get('birth')||'');r.age=calcAge(r.birth);r.ageGroup=calcGroup(r.birth);r.parentWhatsapp=String(f.get('parentWhatsapp')||'').trim();r.classCategory=String(f.get('classCategory')||'');r.package=String(f.get('package')||'');r.healthNote=String(f.get('healthNote')||'').trim();r.updatedAt=new Date().toISOString();try{await commitCriticalRecord('pendingRegistrations',r.id);document.querySelector('#registrationEditDialog')?.close();render()}catch(error){console.error('Pendaftaran gagal diperbarui:',error);alert(error.message||'Pendaftaran belum diperbarui di Supabase.')}
 })
  document.querySelectorAll('[data-approve-registration]').forEach(b=>b.onclick=async()=>{
   const r=state.pendingRegistrations.find(x=>x.id===b.dataset.approveRegistration)
   if(!r)return
   const athleteId=nextAthleteId()
   state.athletes.push({
     id:athleteId,name:r.name,photo:r.photo||'',birth:r.birth,age:calcAge(r.birth),ageGroup:calcGroup(r.birth),
     gender:r.gender||'',classCategory:r.classCategory||'',healthNotes:r.healthNote||'',birthCertificate:r.certificate||'',
     registrationProof:r.paymentProof||'',package:r.package||'',parentWhatsapp:r.parentWhatsapp||'',
     parentPassword:'',parentMustChange:true,registrationId:r.id,
     trainingCategory:r.trainingCategory||'Pemula',trainingGroups:Array.isArray(r.trainingGroups)?r.trainingGroups:[calcGroup(r.birth)].filter(Boolean)
   })
   r.status='approved';r.approvedAt=new Date().toISOString();r.athleteId=athleteId
    try{
      await commitCriticalRecord('athletes',athleteId)
      await commitCriticalRecord('pendingRegistrations',r.id)
      await upsertFinanceReference({direction:'income',referenceType:'athlete_registration',referenceId:r.id,amount:Number(r.amount||r.registrationAmount||0),category:'PENDAFTARAN',transactionType:'registration_payment',description:`Pembayaran Pendaftaran Atlet - ${r.name}`,athleteId,athleteName:r.name,proofUrl:r.paymentProof,transactionDate:r.approvedAt})
      alert(`${r.name} disetujui dan ditambahkan sebagai atlet dengan ID ${athleteId}.`);render()
    }catch(error){console.error('Persetujuan pendaftar gagal disimpan ke asc_athletes:',error);alert(error.message||'Data atlet belum berhasil disimpan ke Supabase.')}
 })
 document.querySelectorAll('[data-reject-registration]').forEach(b=>b.onclick=async()=>{
   const r=state.pendingRegistrations.find(x=>x.id===b.dataset.rejectRegistration)
   if(r&&confirm(`Tolak pendaftaran ${r.name}?`)){const reason=prompt('Tuliskan alasan penolakan:','Berkas atau pembayaran belum sesuai.');if(reason===null)return;r.status='rejected';r.adminNote=reason.trim()||'Pendaftaran ditolak oleh Admin.';r.rejectedAt=new Date().toISOString();try{await commitCriticalRecord('pendingRegistrations',r.id);render()}catch(error){console.error('Pendaftaran gagal diperbarui:',error);alert(error.message||'Pendaftaran belum diperbarui di Supabase.')}}
 })
 document.querySelectorAll('[data-delete-registration]').forEach(b=>b.onclick=async()=>{
   if(confirm('Hapus riwayat pendaftaran ini?')){try{await deleteDedicatedSafely('pendingRegistrations',b.dataset.deleteRegistration)}catch(error){console.error('Pendaftaran gagal ditandai terhapus:',error);alert(error.message||'Pendaftaran belum terhapus di Supabase.')}}
 })
 document.querySelector('#addCoach')?.addEventListener('click',()=>{const d=document.querySelector('#coachDialog'),f=document.querySelector('#coachForm');if(!d||!f)return;f.reset();f.elements.editId.value='';f.elements.active.value='true';f.elements.password.required=true;document.querySelector('#coachDialogTitle').textContent='Tambah Pelatih';document.querySelector('#coachCurrentPhoto').innerHTML='';d.showModal()})
 document.querySelectorAll('[data-edit-coach]').forEach(b=>b.onclick=()=>{const c=state.coaches.find(x=>x.id===b.dataset.editCoach),d=document.querySelector('#coachDialog'),f=document.querySelector('#coachForm');if(!c||!d||!f)return;f.reset();f.elements.editId.value=c.id;f.elements.name.value=c.name||'';f.elements.username.value=c.username||'';f.elements.active.value=String(c.active!==false);f.elements.password.required=false;document.querySelector('#coachDialogTitle').textContent='Edit Pelatih';document.querySelector('#coachCurrentPhoto').innerHTML=c.photo?`<img class="table-avatar large" src="${c.photo}" alt="Foto ${esc(c.name)}"><span>Foto profil saat ini</span>`:'<span class="hint">Belum ada foto profil.</span>';d.showModal()})
 document.querySelector('#coachForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),editId=String(f.get('editId')||''),existing=state.coaches.find(c=>c.id===editId),username=String(f.get('username')).trim();if(state.coaches.some(c=>c.id!==editId&&c.username.toLowerCase()===username.toLowerCase()))return alert('Username pelatih sudah digunakan.');const coachPassword=String(f.get('password')||'');if(!existing&&!validCoachPassword(coachPassword)){alert('Password awal pelatih harus tepat 6 karakter dan hanya boleh huruf atau angka.');return}if(existing&&coachPassword&&!validCoachPassword(coachPassword)){alert('Password baru pelatih harus tepat 6 karakter dan hanya boleh huruf atau angka.');return}let photo=existing?.photo||'';try{const uploaded=await imageData(f.get('photo'),500);if(uploaded)photo=uploaded}catch(error){alert(error.message);return}const payload={...(existing||{}),id:existing?.id||nextCoachId(),name:String(f.get('name')).trim(),username,photo,active:String(f.get('active'))!=='false'};if(existing){if(coachPassword){payload.password=coachPassword;payload.mustChangePassword=true}state.coaches=state.coaches.map(c=>c.id===editId?payload:c)}else state.coaches.push({...payload,password:coachPassword,mustChangePassword:true});try{await commitCriticalRecord('coaches',payload.id);document.querySelector('#coachDialog').close();render()}catch(error){console.error('Pelatih gagal disimpan:',error);alert(error.message||'Data pelatih belum tersimpan di Supabase.')}})
 document.querySelectorAll('[data-delete-coach]').forEach(b=>b.onclick=async()=>{if(state.coaches.length<=1)return alert('Minimal harus ada satu akun pelatih.');if(confirm('Hapus akun pelatih ini?')){try{await deleteDedicatedSafely('coaches',b.dataset.deleteCoach)}catch(error){console.error('Pelatih gagal ditandai terhapus:',error);alert(error.message||'Data pelatih belum terhapus di Supabase.')}}})
 document.querySelector('#coachPasswordForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),password=String(f.get('password')||''),confirmPassword=String(f.get('confirm')||''),error=document.querySelector('#coachPasswordError');if(!validCoachPassword(password)){error.textContent='Password harus tepat 6 karakter dan hanya boleh huruf atau angka.';return}if(password!==confirmPassword){error.textContent='Konfirmasi password tidak sama.';return}const c=currentCoach();c.password=password;c.mustChangePassword=false;persistDedicatedSoon('coaches',c.id);currentPage='coachDashboard';render()})
 document.querySelector('#coachSettingsPasswordForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),currentPassword=String(f.get('currentPassword')||''),password=String(f.get('password')||''),confirmPassword=String(f.get('confirm')||''),error=document.querySelector('#coachSettingsError'),c=currentCoach();if(currentPassword!==c.password){error.textContent='Password saat ini salah.';return}if(!validCoachPassword(password)){error.textContent='Password baru harus tepat 6 karakter dan hanya boleh huruf atau angka.';return}if(password!==confirmPassword){error.textContent='Konfirmasi password tidak sama.';return}c.password=password;c.mustChangePassword=false;persistDedicatedSoon('coaches',c.id);e.currentTarget.reset();alert('Password pelatih berhasil diganti.')})
 document.querySelector('#coachPhotoForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),error=document.querySelector('#coachPhotoError'),c=currentCoach();try{const photo=await imageData(f.get('photo'),500);if(!photo)throw new Error('Silakan pilih foto profil.');c.photo=photo;await commitCriticalRecord('coaches',c.id);alert('Foto profil pelatih berhasil diperbarui.');render()}catch(err){if(error)error.textContent=err.message||'Foto gagal diunggah.'}})

 document.querySelector('#parentPasswordForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),password=String(f.get('password')||''),confirmPassword=String(f.get('confirm')||'');const error=document.querySelector('#passwordError');if(!validParentPassword(password)){error.textContent='Password harus tepat 6 karakter dan hanya boleh memakai huruf atau angka.';return}if(password!==confirmPassword){error.textContent='Konfirmasi password tidak sama.';return}const a=parentAthlete();a.parentPassword=password;a.parentMustChange=false;queueSave();currentPage='parentDashboard';render()})
 document.querySelector('#downloadAthletesPdf')?.addEventListener('click',downloadAthletesPdf);document.querySelector('#downloadAthletesExcel')?.addEventListener('click',downloadAthletesExcel);document.querySelector('#addAthlete')?.addEventListener('click',()=>document.querySelector('#athleteDialog').showModal());document.querySelector('#addTime')?.addEventListener('click',()=>{const f=document.querySelector('#timeForm');f?.reset();if(f?.elements.editId)f.elements.editId.value='';const t=document.querySelector('#timeDialogTitle');if(t)t.textContent='Tambah Catatan Waktu';document.querySelector('#levelField')?.classList.add('hidden');document.querySelector('#timeDialog')?.showModal()});document.querySelector('#addProgram')?.addEventListener('click',()=>{const f=document.querySelector('#programForm');f?.reset();if(f?.elements.editId)f.elements.editId.value='';const t=document.querySelector('#programDialogTitle');if(t)t.textContent='Upload Program Latihan';document.querySelector('#programDialog')?.showModal()})
 const ab=document.querySelector('#athleteForm input[name="birth"]');ab?.addEventListener('input',()=>document.querySelector('#athleteAuto').innerHTML=`<b>ID:</b> ${nextAthleteId()} &nbsp; <b>Umur:</b> ${calcAge(ab.value)} tahun &nbsp; <b>KU:</b> ${calcGroup(ab.value)}`)
 document.querySelector('#athleteForm')?.addEventListener('submit',async e=>{
   e.preventDefault();const form=e.currentTarget,f=new FormData(form),birth=String(f.get('birth')),editId=String(f.get('editId')||'')
   const existing=state.athletes.find(a=>a.id===editId),athleteId=existing?.id||nextAthleteId()
   try{
   setFormBusy(form,true,'Mengunggah dan menyimpan...')
   const uploadOrKeep=async(file,type,oldValue='')=>file&&file.size?registrationUpload(file,type,athleteId):oldValue
   const athlete={...(existing||{}),id:athleteId,name:String(f.get('name')).trim(),gender:String(f.get('gender')||''),birthPlace:String(f.get('birthPlace')||''),birth,age:calcAge(birth),ageGroup:calcGroup(birth),parentWhatsapp:String(f.get('parentWhatsapp')||''),parentPhone:String(f.get('parentWhatsapp')||''),schoolName:String(f.get('schoolName')||''),healthNotes:String(f.get('healthNotes')||''),photo:await uploadOrKeep(f.get('photo'),'photo',existing?.photo||''),familyCard:await uploadOrKeep(f.get('familyCard'),'family-card',existing?.familyCard||''),birthCertificate:await uploadOrKeep(f.get('birthCertificate'),'birth-certificate',existing?.birthCertificate||''),registrationProof:await uploadOrKeep(f.get('registrationProof'),'registration-proof',existing?.registrationProof||''),trainingCategory:String(f.get('trainingCategory')||'Pemula'),trainingGroups:f.getAll('trainingGroups'),parentPassword:existing?.parentPassword||'',parentMustChange:existing?.parentMustChange??true,profileUpdatedAt:new Date().toISOString(),profileUpdatedBy:'admin',updatedAt:new Date().toISOString()}
   if(existing)Object.assign(existing,athlete);else state.athletes.push({...athlete,createdAt:new Date().toISOString()})
   await commitCriticalRecord('athletes',athlete.id);document.querySelector('#athleteDialog').close();render()
   }catch(err){alert(err.message||'Data atlet gagal disimpan.')}finally{setFormBusy(form,false)}
 })
 document.querySelector('#athleteSearch')?.addEventListener('input',filterAthletes)
 document.querySelector('#athleteKuFilter')?.addEventListener('change',filterAthletes)
 function filterAthletes(){const q=String(document.querySelector('#athleteSearch')?.value||'').toLowerCase(),ku=String(document.querySelector('#athleteKuFilter')?.value||'');document.querySelectorAll('[data-athlete-row]').forEach(row=>row.hidden=!(row.dataset.name.includes(q)&&(!ku||row.dataset.ku===ku)))}
 document.querySelectorAll('[data-view-athlete]').forEach(b=>b.onclick=()=>{const a=state.athletes.find(x=>x.id===b.dataset.viewAthlete);if(!a)return;const fileLink=(v,label)=>v?`<a class="secondary small inline-button" href="${esc(v)}" target="_blank" rel="noopener">Preview/Download ${label}</a>`:'<span>Belum ada</span>';document.querySelector('#athleteDetailContent').innerHTML=`<div class="athlete-detail-grid"><div>${a.photo?`<img class="athlete-detail-photo" src="${esc(a.photo)}">`:'<div class="athlete-detail-photo placeholder">♟</div>'}</div><div><p><b>ID Atlet:</b> ${esc(a.id)}</p><p><b>Nama:</b> ${esc(a.name)}</p><p><b>Sekolah:</b> ${esc(a.schoolName||'-')}</p><p><b>Nomor Telepon:</b> ${esc(a.parentPhone||a.parentWhatsapp||'-')}</p><p><b>Tempat, Tanggal Lahir:</b> ${esc([a.birthPlace,a.birth].filter(Boolean).join(', ')||'-')}</p><p><b>Umur / KU:</b> ${a.age??calcAge(a.birth)} tahun / ${esc(a.ageGroup||calcGroup(a.birth))}</p><p><b>Catatan Kesehatan:</b> ${esc(a.healthNotes||'-')}</p><div class="document-actions">${fileLink(a.familyCard,'Kartu Keluarga')}${fileLink(a.birthCertificate,'Akta Kelahiran')}${fileLink(a.registrationProof,'Bukti Pembayaran')}</div></div></div>`;document.querySelector('#athleteDetailDialog').showModal()})
 document.querySelectorAll('[data-reset-parent-password]').forEach(b=>b.onclick=()=>{
   if(role!=='admin')return
   const a=state.athletes.find(x=>x.id===b.dataset.resetParentPassword)
   if(!a)return
   if(!confirm(`Reset akun orang tua untuk ${a.name}? Password awal akan kembali menjadi ID Atlet: ${a.id}`))return
   a.parentPassword=''
   a.parentMustChange=true
   a.passwordResetAt=new Date().toISOString()
   queueSave()
   alert(`Akun orang tua berhasil direset.\n\nUsername: ${a.id}\nPassword awal: ${a.id}\n\nOrang tua wajib mengganti password setelah login.`)
   render()
 })
 document.querySelectorAll('[data-edit-athlete]').forEach(b=>b.onclick=()=>{const a=state.athletes.find(x=>x.id===b.dataset.editAthlete),d=document.querySelector('#athleteDialog'),f=document.querySelector('#athleteForm');if(!a||!d||!f)return;document.querySelector('#athleteDialogTitle').textContent='Edit Data Atlet';f.elements.editId.value=a.id;f.elements.name.value=a.name||'';f.elements.gender.value=a.gender||'';f.elements.birthPlace.value=a.birthPlace||'';f.elements.birth.value=a.birth||'';f.elements.parentWhatsapp.value=a.parentPhone||a.parentWhatsapp||'';f.elements.schoolName.value=a.schoolName||'';f.elements.healthNotes.value=a.healthNotes||'';f.elements.trainingCategory.value=a.trainingCategory||'Pemula';f.querySelectorAll('[name="trainingGroups"]').forEach(x=>x.checked=(a.trainingGroups||[]).includes(x.value));document.querySelector('#athleteAuto').innerHTML=`<b>ID:</b> ${esc(a.id)} &nbsp; <b>Umur:</b> ${a.age??calcAge(a.birth)} tahun &nbsp; <b>KU:</b> ${esc(a.ageGroup||calcGroup(a.birth))}`;d.showModal()})
 document.querySelectorAll('[data-delete-athlete]').forEach(b=>b.onclick=async()=>{if(confirm('Hapus atlet ini?')){try{await deleteAthleteSafely(b.dataset.deleteAthlete)}catch(error){console.error('Penghapusan satu record atlet gagal:',error);alert(`Perubahan tersimpan di perangkat, tetapi Supabase gagal: ${error.message||error}`)}}})
 const rt=document.querySelector('#recordType');rt?.addEventListener('change',()=>document.querySelector('#levelField').classList.toggle('hidden',rt.value!=='Kejuaraan'))
 document.querySelector('#timeAthleteFilter')?.addEventListener('change',e=>{window.__ascTimeAthlete=e.target.value;render()})
 document.querySelector('#timeForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);let time=String(f.get('time')||'').trim().replace(',', '.');const m=time.match(/^(\d{1,2})[:.](\d{2})[.:](\d{2})$/);if(!m)return alert('Format waktu gunakan MM:SS.CC atau MM.SS.CC, contoh 01:25.48');time=`${m[1].padStart(2,'0')}.${m[2]}.${m[3]}`;const a=state.athletes.find(x=>x.id===f.get('athleteId'));if(!a)return alert('Atlet tidak ditemukan.');const c=currentCoach();const editId=String(f.get('editId')||'');const payload={athleteId:a.id,athleteName:a.name,stroke:f.get('stroke'),distance:Number(f.get('distance')||0),type:f.get('type'),level:f.get('type')==='Kejuaraan'?f.get('level'):'',date:f.get('date'),time,coachId:c?.id||'',coachName:c?.name||'Admin'};let recordId=editId;if(editId){const i=state.timeRecords.findIndex(r=>r.id===editId);if(i>=0)state.timeRecords[i]={...state.timeRecords[i],...payload,updatedAt:new Date().toISOString()}}else{recordId=createId();state.timeRecords.push({id:recordId,...payload,createdAt:new Date().toISOString()})}try{setFormBusy(e.currentTarget,true,'Menyimpan...');await commitCriticalRecord('timeRecords',recordId);if(!editId)sendPushNotification({target:'parent',athleteId:a.id,title:'Catatan Waktu Baru',message:`Catatan waktu terbaru untuk ${a.name} telah ditambahkan.`,page:'parentTimes',type:'time_record_created',referenceType:'time_record',eventId:recordId});document.querySelector('#timeDialog')?.close();render()}catch(err){alert(err.message||'Catatan waktu gagal disimpan.')}finally{setFormBusy(e.currentTarget,false)}
 })
 document.querySelectorAll('[data-edit-time]').forEach(b=>b.onclick=()=>{const r=state.timeRecords.find(x=>x.id===b.dataset.editTime),d=document.querySelector('#timeDialog'),f=document.querySelector('#timeForm');if(!r||!d||!f)return;f.elements.editId.value=r.id;f.elements.athleteId.value=r.athleteId||'';f.elements.date.value=r.date||'';f.elements.stroke.value=r.stroke||'';f.elements.distance.value=String(r.distance||25);f.elements.type.value=r.type||'Latihan';f.elements.level.value=r.level||'';f.elements.time.value=r.time||'';document.querySelector('#timeDialogTitle').textContent='Edit Catatan Waktu';document.querySelector('#levelField')?.classList.toggle('hidden',f.elements.type.value!=='Kejuaraan');d.showModal()})
 document.querySelectorAll('[data-delete-time]').forEach(b=>b.onclick=async()=>{try{await deleteDedicatedSafely('timeRecords',b.dataset.deleteTime)}catch(error){console.error('Catatan waktu gagal ditandai terhapus:',error);alert(error.message||'Catatan waktu belum terhapus di Supabase.')}})
 document.querySelector('#programForm')?.addEventListener('submit',async e=>{
   e.preventDefault()
   if(!['admin','coach'].includes(role))return
   const f=new FormData(e.currentTarget)
   const categories=f.getAll('categories')
   const trainingGroups=f.getAll('trainingGroups')
   if(!categories.length){alert('Pilih minimal satu kategori atlet.');return}
   const file=f.get('image')
   const image=file&&file.size?await imageData(file,1200):''
   const editId=String(f.get('editId')||'')
   const payload={categories,trainingGroups,title:String(f.get('title')||'').trim(),date:String(f.get('date')||''),duration:String(f.get('duration')||'').trim(),totalMeters:Number(f.get('totalMeters')||0),details:String(f.get('details')||'').trim(),videoUrl:String(f.get('videoUrl')||'').trim(),updatedAt:new Date().toISOString()}
   let programId=editId
   if(editId){
     const i=state.trainingPrograms.findIndex(p=>p.id===editId)
     if(i>=0)state.trainingPrograms[i]={...state.trainingPrograms[i],...payload,image:image||state.trainingPrograms[i].image||''}
   }else{programId=createId();state.trainingPrograms.push({id:programId,...payload,image,createdAt:new Date().toISOString(),createdBy:role})}
   try{await commitCriticalRecord('trainingPrograms',programId);if(!editId)sendPushNotification({target:'all',title:'Program Latihan Baru',message:'Program latihan baru telah tersedia.',page:'parentPrograms',deepLinkParent:'parentPrograms',deepLinkCoach:'trainingPrograms',trainingCategories:categories,ageGroups:trainingGroups,type:'training_program_created',referenceType:'training_program',eventId:programId});document.querySelector('#programDialog')?.close();render()}catch(error){console.error('Program latihan gagal disimpan:',error);alert(error.message||'Program latihan belum tersimpan di Supabase.')}
 })
 document.querySelectorAll('[data-edit-program]').forEach(b=>b.onclick=()=>{const p=state.trainingPrograms.find(x=>x.id===b.dataset.editProgram),d=document.querySelector('#programDialog'),f=document.querySelector('#programForm');if(!p||!d||!f)return;f.elements.editId.value=p.id;f.elements.title.value=p.title||'';f.elements.date.value=p.date||'';f.elements.duration.value=p.duration||'';f.elements.totalMeters.value=p.totalMeters||'';f.elements.details.value=p.details||'';f.elements.videoUrl.value=p.videoUrl||'';f.querySelectorAll('[name="categories"]').forEach(x=>x.checked=(p.categories||[]).includes(x.value));f.querySelectorAll('[name="trainingGroups"]').forEach(x=>x.checked=(p.trainingGroups||[]).includes(x.value));const t=document.querySelector('#programDialogTitle');if(t)t.textContent='Edit Program Latihan';d.showModal()})
 document.querySelectorAll('[data-delete-program]').forEach(b=>b.onclick=async()=>{if(!['admin','coach'].includes(role))return;if(confirm('Hapus program latihan ini?')){try{await deleteDedicatedSafely('trainingPrograms',b.dataset.deleteProgram)}catch(error){console.error('Program latihan gagal ditandai terhapus:',error);alert(error.message||'Program latihan belum terhapus di Supabase.')}}})
 document.querySelector('#attendanceDate')?.addEventListener('change',e=>{window.__ascAttendanceDate=e.target.value;render()})
 document.querySelectorAll('.attendance-status').forEach(el=>el.addEventListener('change',async e=>{const date=window.__ascAttendanceDate||new Date().toISOString().slice(0,10),athleteId=e.target.dataset.athleteId,a=state.athletes.find(x=>x.id===athleteId);let r=state.attendance.find(x=>x.date===date&&x.athleteId===athleteId);if(!r){r={id:createId(),date,athleteId,athleteName:a?.name||athleteId,status:'',note:''};state.attendance.push(r)}r.status=e.target.value;r.updatedAt=new Date().toISOString();r.updatedBy=role;try{await commitCriticalRecord('attendance',r.id);sendPushNotification({target:'parent',athleteId,title:'Informasi Kehadiran Atlet',message:`Status kehadiran ${a?.name||athleteId}: ${r.status||'Belum Diisi'}.`,page:'parentAttendance',type:'attendance_updated',referenceType:'attendance',eventId:r.id})}catch(error){console.error('Status absensi gagal disimpan:',error);alert(error.message||'Status absensi belum berhasil disimpan ke Supabase.')}}))
 document.querySelectorAll('.attendance-note').forEach(el=>el.addEventListener('change',async e=>{const date=window.__ascAttendanceDate||new Date().toISOString().slice(0,10),athleteId=e.target.dataset.athleteId,a=state.athletes.find(x=>x.id===athleteId);let r=state.attendance.find(x=>x.date===date&&x.athleteId===athleteId);if(!r){r={id:createId(),date,athleteId,athleteName:a?.name||athleteId,status:'',note:''};state.attendance.push(r)}r.note=e.target.value;r.updatedAt=new Date().toISOString();r.updatedBy=role;try{await commitCriticalRecord('attendance',r.id)}catch(error){console.error('Catatan absensi gagal disimpan:',error);alert(error.message||'Catatan absensi belum berhasil disimpan ke Supabase.')}}))
 document.querySelector('#settingsForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);state.settings.clubName=String(f.get('clubName')||'AQILAH Swimming Club').trim();state.settings.coachName=String(f.get('coachName')||'').trim();const logoFile=f.get('logo');if(logoFile&&logoFile.size)state.settings.logo=await imageData(logoFile,500);queueSave();alert('Identitas dan logo berhasil disimpan.');render()})
 document.querySelector('#adminPasswordForm')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget),currentPassword=String(f.get('currentPassword')||''),newPassword=String(f.get('newPassword')||''),confirmPassword=String(f.get('confirmPassword')||''),error=document.querySelector('#adminPasswordError');error.textContent='';if(currentPassword!==state.settings.adminPassword){error.textContent='Password saat ini salah.';return}if(!/^[A-Za-z0-9]{6}$/.test(newPassword)){error.textContent='Password baru harus tepat 6 karakter dan hanya boleh huruf atau angka.';return}if(newPassword!==confirmPassword){error.textContent='Konfirmasi password baru tidak sama.';return}state.settings.adminPassword=newPassword;queueSave();e.currentTarget.reset();alert('Password Admin berhasil diganti.')})
 document.querySelectorAll('[data-finance-filter]').forEach(el=>{const apply=()=>{window.__ascFinanceFilters={...(window.__ascFinanceFilters||{}),[el.dataset.financeFilter]:el.value};window.__ascFinancePage=1;render()};el.addEventListener('change',apply);if(el.dataset.financeFilter==='search')el.addEventListener('input',apply)})
 document.querySelectorAll('[data-finance-page]').forEach(button=>button.addEventListener('click',()=>{const next=Number(button.dataset.financePage||1);if(next>0){window.__ascFinancePage=next;render()}}))
 document.querySelectorAll('[data-add-finance]').forEach(button=>button.addEventListener('click',()=>{const form=document.querySelector('#financeForm'),dialog=document.querySelector('#financeDialog');if(!form||!dialog)return;form.reset();form.elements.direction.value=button.dataset.addFinance;form.elements.transactionDate.value=new Date().toISOString().slice(0,16);dialog.showModal()}))
 document.querySelector('#financeForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),id=createId();try{setFormBusy(e.currentTarget,true,'Menyimpan...');const file=f.get('proof'),proofUrl=file?.size?await registrationUpload(file,'payment',`finance/${id}`):'';await upsertFinanceReference({direction:String(f.get('direction')),referenceType:'manual',referenceId:id,amount:Number(f.get('amount')),category:String(f.get('category')),transactionType:'manual',description:String(f.get('description')),athleteName:String(f.get('relatedName')||''),proofUrl,transactionDate:new Date(String(f.get('transactionDate'))).toISOString()});document.querySelector('#financeDialog')?.close();render()}catch(error){console.error('Transaksi manual gagal disimpan:',error);alert(error.message||'Transaksi belum tersimpan di Supabase.')}finally{setFormBusy(e.currentTarget,false)}})
 document.querySelectorAll('[data-view-finance]').forEach(button=>button.addEventListener('click',()=>{const x=activeFinanceRows().find(row=>row.id===button.dataset.viewFinance),content=document.querySelector('#financeDetailContent'),dialog=document.querySelector('#financeDetailDialog');if(!x||!content||!dialog)return;content.innerHTML=`<dl class="detail-list"><dt>Nomor Transaksi</dt><dd>${esc(x.transactionNumber||x.id)}</dd><dt>Tanggal & Waktu</dt><dd>${new Date(x.transactionDate||x.createdAt).toLocaleString('id-ID')}</dd><dt>Jenis</dt><dd>${x.direction==='income'?'Pemasukan':'Pengeluaran'}</dd><dt>Kategori</dt><dd>${esc(normalizeFinanceCategory(x.category))}</dd><dt>Nominal</dt><dd>Rp${Number(x.amount||0).toLocaleString('id-ID')}</dd><dt>Dibuat Oleh</dt><dd>${esc(x.createdBy||x.createdRole||'-')}</dd><dt>Referensi</dt><dd>${esc(`${x.referenceType||'-'} / ${x.referenceId||'-'}`)}</dd><dt>Keterangan</dt><dd>${esc(x.description||'-')}</dd><dt>Bukti</dt><dd>${x.proofUrl?`<a href="${esc(x.proofUrl)}" target="_blank" rel="noopener">Lihat bukti</a>`:'-'}</dd></dl>`;dialog.showModal()}))
 document.querySelectorAll('[data-delete-finance]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Tandai transaksi manual ini terhapus?'))return;try{await deleteDedicatedSafely('financeTransactions',button.dataset.deleteFinance)}catch(error){console.error('Transaksi keuangan gagal dihapus:',error);alert(error.message||'Transaksi belum berhasil dihapus dari Supabase.')}}))
 document.querySelector('#downloadFinanceExcel')?.addEventListener('click',()=>{const rows=financeFilteredRows().map((x,i)=>[i+1,x.transactionNumber||x.id,x.transactionDate||'',x.direction,normalizeFinanceCategory(x.category),x.description||'',x.athleteName||x.coachName||'',Number(x.amount||0)]);downloadXmlExcel(`Keuangan-ASC-${new Date().toISOString().slice(0,10)}.xls`,'Keuangan',['No','Nomor Transaksi','Tanggal','Jenis','Kategori','Keterangan','Nama','Nominal'],rows)})
 document.querySelector('#downloadFinancePdf')?.addEventListener('click',()=>{const doc=new jsPDF({orientation:'landscape'}),rows=financeFilteredRows();doc.text('Riwayat Transaksi Keuangan AQILAH Swimming Club',14,14);autoTable(doc,{startY:20,head:[['Nomor','Tanggal','Jenis','Kategori','Keterangan','Nama','Nominal']],body:rows.map(x=>[x.transactionNumber||x.id,new Date(x.transactionDate).toLocaleString('id-ID'),x.direction==='income'?'Pemasukan':'Pengeluaran',normalizeFinanceCategory(x.category),x.description||'',x.athleteName||x.coachName||'',`Rp${Number(x.amount||0).toLocaleString('id-ID')}`])});saveDownloadFile(doc.output('blob'),`Keuangan-ASC-${new Date().toISOString().slice(0,10)}.pdf`,'application/pdf')})
}
function render(){
  if(!role)return loginPage()
  if(role==='parent'){
    const a=parentAthlete()
    if(!a){clearActiveSession();role='';parentAthleteId='';return loginPage()}
    if(a.parentMustChange&&currentPage!=='parentPassword')currentPage='parentPassword'
  }
  if(role==='coach'&&!currentCoach()){clearActiveSession();role='';coachId='';return loginPage()}
  if(role==='coach'&&currentCoach()?.mustChangePassword&&currentPage!=='coachPassword')currentPage='coachPassword'
  persistActiveSession()
  app.innerHTML=shell(pageContent());bindEvents()
}

function maybeShowDrylandReminder(){
 if(role!=='parent')return
 const a=parentAthlete()
 if(!a||!state.parentReminders[a.id]||new Date().getDay()!==3)return
 const key=`dryland-reminder-${a.id}-${new Date().toISOString().slice(0,10)}`
 if(localStorage.getItem(key))return
 trySetLocalStorage(key,'1')
 const body='Saatnya melakukan peregangan dan tugas dryland sebelum latihan berikutnya.'
 if('Notification'in window&&Notification.permission==='granted')new Notification('Pengingat Latihan Mandiri AQILAH',{body})
}
let deferredInstallPrompt = null
function setupPwaInstall(){
  if (document.querySelector('#pwaInstallBtn')) return
  const button=document.createElement('button')
  button.id='pwaInstallBtn'
  button.type='button'
  button.className='pwa-install-button'
  button.innerHTML='<span aria-hidden="true">⬇</span><span>Pasang Aplikasi</span>'
  document.body.appendChild(button)

  const standalone=window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone===true
  if(standalone) return

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault()
    deferredInstallPrompt=event
    button.classList.add('show')
  })
  button.addEventListener('click',async()=>{
    if(!deferredInstallPrompt)return
    button.classList.remove('show')
    deferredInstallPrompt.prompt()
    try{await deferredInstallPrompt.userChoice}catch{}
    deferredInstallPrompt=null
  })
  window.addEventListener('appinstalled',()=>{
    deferredInstallPrompt=null
    button.remove()
  })
}

async function start(){
  // Tampilkan login/dashboard dari data lokal seketika. Jangan menunggu internet.
 loadLocal()
 if(role)syncStoredPushDevice()
  const localCleanup=cleanupExpiredCompetitionPayments()
  if(localCleanup.changed)queueSave()
  syncStatus = navigator.onLine ? 'Menghubungkan data...' : 'Data perangkat siap digunakan'
  render()
  setupPwaInstall()
  maybeShowDrylandReminder()

  // Service worker hanya dipakai pada build produksi. Pada localhost Vite harus bebas dari cache PWA lama.
  if ('serviceWorker' in navigator) {
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(() => {})
      if ('caches' in window) caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(() => {})
    } else {
      navigator.serviceWorker.register('/sw.js', { updateViaCache:'none' }).catch(() => {})
    }
  }

  // Supabase disinkronkan di belakang layar agar halaman tidak putih atau lambat.
  loadRemote()
    .then(remoteChanged => {
      const remoteCleanup=cleanupExpiredCompetitionPayments()
      if(remoteCleanup.changed)queueSave()
      subscribeRealtime()
      flushFinanceOfflineQueue()
      if(remoteChanged||remoteCleanup.changed)renderRemoteUpdateSafely()
      maybeShowDrylandReminder()
    })
    .catch(() => {
      syncStatus = 'Data perangkat siap digunakan'
      updateSync()
    })

  // Selama aplikasi terbuka, periksa kembali setiap jam agar data pembayaran
  // lomba terhapus tepat setelah melewati 7 hari dari batas pendaftaran.
  window.setInterval(()=>{
    const cleanup=cleanupExpiredCompetitionPayments()
    if(cleanup.changed){queueSave();renderRemoteUpdateSafely()}
  },60*60*1000)
}
start()
