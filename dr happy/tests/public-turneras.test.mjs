import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { normalizeBlocks, pickBlock } from '../supabase/functions/_shared/publicBookingBlocks.ts'

const template = { days: [0,1,2,3,4,5,6], startTime: '09:00', endTime: '12:00', durationMinutes: 30, slotCount: 6, dailyQuota: 2, modality: 'coverage' }
const blocks = [
  { ...template, id: 'ioma', label: 'IOMA' },
  { ...template, id: 'pami', label: 'PAMI' },
  { ...template, id: 'private-a', label: 'Particular Centro', modality: 'private', amountToCharge: 1000 },
  { ...template, id: 'private-b', label: 'Particular Norte', modality: 'private', amountToCharge: 2500 },
]
const code = ts.transpile((await readFile(new URL('../supabase/functions/public-booking/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, ''), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
function fixture() {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0,10)
  const profile = { professional_id: 'owner', slug: 'fixture', enabled: true, professional_name: 'Fixture', horizon_days: 60, availability_blocks: structuredClone(blocks) }
  const records = {
    public_booking_profiles: [profile], user_workspaces: [{ user_id: 'owner', appointments_json: [] }],
    public_booking_reservations: [], professional_payment_accounts: [{ professional_id: 'owner', provider: 'mercadopago', status: 'connected' }],
  }
  const state = { identity: 'owner', fail: false }
  const writes = []
  const admin = { from(table) {
    const filters = []; let value, operation
    const q = { select() { return q }, maybeSingle() { q.singleResult = true; return q }, single() { q.singleResult = true; return q },
      eq(k,v) { filters.push(r => r[k] === v); return q },
      gte(k,v) { filters.push(r => r[k] >= v); return q }, lte(k,v) { filters.push(r => r[k] <= v); return q }, lt(k,v) { filters.push(r => r[k] < v); return q },
      update(v) { value=v; operation='update'; return q }, upsert(v) { value=v; operation='upsert'; return q },
      then(resolve,reject) {
        if(state.fail) return Promise.resolve({ error:{ message:'fixture database failure' } }).then(resolve,reject)
        const selected = records[table].filter(r => filters.every(f=>f(r)))
        if(operation === 'update') for(const row of selected) Object.assign(row,value)
        if(operation === 'upsert') { writes.push(value); Object.assign(profile,value); selected.splice(0,selected.length,profile) }
        return Promise.resolve({ data: q.singleResult ? selected[0] ?? null : selected, error:null }).then(resolve,reject)
      },
    }; return q
  } }
  let handler
  vm.runInNewContext(code,{ serve:fn=>{handler=fn}, createClient:()=>admin, normalizeBlocks,pickBlock, resolveProfessionalId:async()=>state.identity,
    getHolidayName:()=>null, corsHeaders:{}, Deno:{ env:{get:()=> 'fixture'} }, crypto,Date,Request,Response,console:{error(){}},
  })
  return { records, state, writes, date, profile, async call(body) {
    const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)}))
    return { status:response.status, body:await response.json() }
  } }
}
test('more than ten turneras retain names, independent prices, identifiers and paused states', () => {
  const input = Array.from({length:15},(_,i)=>({...blocks[i%4],id:'block-'+i,label:'Turnera '+i,enabled:i!==2}))
  const result=normalizeBlocks(input)
  assert.equal(result.length,15)
  assert.deepEqual(result.map(b=>b.label),input.map(b=>b.label))
  assert.equal(result[2].enabled,false)
  assert.equal(result[3].amountToCharge,2500)
  assert.equal(pickBlock(result,undefined,'block-2'),undefined)
  assert.equal(pickBlock(result,undefined,'unknown'),undefined)
  assert.equal(pickBlock(result,undefined,'block-3').id,'block-3')
  assert.equal(pickBlock(normalizeBlocks(blocks),'coverage').id,'ioma')
})
test('invalid schedules and quotas are rejected instead of silently publishing fewer turneras', async()=>{
  const h=fixture()
  const settings={ professionalId:'attacker', professionalName:'Fixture',slug:'fixture',enabled:true,blocks }
  for(const patch of [{dailyQuota:7},{slotCount:7},{startTime:'25:00'},{durationMinutes:0},{enabled:'true'}]) {
    const result=await h.call({action:'save-public-settings',settings:{...settings,blocks:[{...blocks[0],...patch}]}})
    assert.equal(result.status,400,JSON.stringify(patch))
  }
  assert.equal((await h.call({action:'save-public-settings',settings:{...settings,blocks:[blocks[0],blocks[0]]}})).status,400)
  assert.equal(h.writes.length,0)
})
test('settings use authenticated owner, allow 15 turneras, and require Mercado Pago only for active paid turneras',async()=>{
  const h=fixture()
  const settings={professionalId:'attacker',professionalName:'Fixture',slug:'fixture',enabled:true,blocks:Array.from({length:15},(_,i)=>({...blocks[i%4],id:'id-'+i}))}
  assert.equal((await h.call({action:'save-public-settings',settings})).status,200)
  assert.equal(h.writes[0].professional_id,'owner')
  assert.equal(h.writes[0].availability_blocks.length,15)
  h.records.professional_payment_accounts[0].status='disconnected'
  assert.equal((await h.call({action:'save-public-settings',settings})).status,409)
  assert.equal((await h.call({action:'save-public-settings',settings:{...settings,blocks:settings.blocks.map(b=>({...b,enabled:b.modality!=='private'}))}})).status,200)
  h.state.identity=null
  assert.equal((await h.call({action:'save-public-settings',settings})).status,401)
})
test('availability blocks whole intervals across turneras; quota belongs to ID, not modality',async()=>{
  const h=fixture()
  h.records.public_booking_reservations.push({professional_id:'owner',slot_date:h.date,slot_time:'09:00',block_id:'ioma',status:'confirmed',duration_minutes:45})
  h.profile.availability_blocks[0].dailyQuota=1
  const query={action:'get-public-agenda',slug:'fixture',startDate:h.date,days:1}
  const ioma=await h.call({...query,blockId:'ioma'})
  assert.equal(ioma.status,200)
  assert.equal(ioma.body.days[0].slots.some(s=>s.available),false)
  const pami=await h.call({...query,blockId:'pami'})
  assert.equal(pami.body.profile.label,'PAMI')
  assert.deepEqual(pami.body.days[0].slots.filter(s=>s.available).map(s=>s.time),['10:00','10:30','11:00','11:30'])
  const paid=await h.call({...query,blockId:'private-b'})
  assert.equal(paid.body.days[0].slots[0].amountToCharge,2500)
  h.profile.availability_blocks[1].enabled=false
  assert.equal((await h.call({...query,blockId:'pami'})).status,404)
  assert.equal((await h.call({...query,blockId:'unknown'})).status,404)
  h.state.fail=true
  assert.equal((await h.call({...query,blockId:'ioma'})).status,500)
})
test('paused turneras reject direct bookings without modifying existing reservations',async()=>{
  const h=fixture(); h.profile.availability_blocks[0].enabled=false
  const result=await h.call({action:'book-public-slot',slug:'fixture',blockId:'ioma',slotDate:h.date,slotTime:'09:00',patientName:'Fixture',patientDni:'12345678',patientEmail:'fixture@example.invalid'})
  assert.equal(result.status,409)
  assert.equal(h.records.public_booking_reservations.length,0)
})

test('deleting turneras persists without deleting bookings or releasing occupied intervals', async()=>{
  const h=fixture()
  h.records.public_booking_reservations.push(
    {professional_id:'owner',slot_date:h.date,slot_time:'09:00',block_id:'ioma',status:'confirmed',duration_minutes:45},
    {professional_id:'owner',slot_date:h.date,slot_time:'10:00',block_id:'private-a',status:'pending_payment',duration_minutes:60,created_at:new Date().toISOString()},
  )
  const reservations=structuredClone(h.records.public_booking_reservations)
  const settings={professionalId:'owner',professionalName:'Fixture',slug:'fixture',enabled:true,blocks:blocks.filter(b=>!['ioma','private-a'].includes(b.id))}
  assert.equal((await h.call({action:'save-public-settings',settings})).status,200)
  assert.deepEqual(h.records.public_booking_reservations,reservations)
  const query={action:'get-public-agenda',slug:'fixture',startDate:h.date,days:1}
  assert.equal((await h.call({...query,blockId:'ioma'})).status,404)
  assert.equal((await h.call({...query,blockId:'private-a'})).status,404)
  const agenda=await h.call({...query,blockId:'pami'})
  assert.deepEqual(agenda.body.days[0].slots.filter(s=>s.available).map(s=>s.time),['11:00','11:30'])
  const booking=await h.call({action:'book-public-slot',slug:'fixture',blockId:'ioma',slotDate:h.date,slotTime:'11:00',patientName:'Fixture',patientDni:'12345678',patientEmail:'fixture@example.invalid'})
  assert.equal(booking.status,409)
  assert.equal((await h.call({action:'save-public-settings',settings:{...settings,blocks:[],enabled:false}})).status,200)
  assert.equal(h.profile.enabled,false)
  assert.deepEqual(h.profile.availability_blocks,[])
  assert.deepEqual(h.records.public_booking_reservations,reservations)
})

test('editor confirms deletion, saves once, preserves other IDs and waits for successful persistence', async()=>{
  const source=await readFile(new URL('../src/PublicTurnerasEditor.tsx',import.meta.url),'utf8')
  const exports={}
  let confirmed=true, message=''
  vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}),{
    exports,require:name=>name==='react/jsx-runtime' ? {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})} : {buildFixedPublicBookingUrl:()=>'',buildWhatsAppShareUrl:()=>''},
    window:{confirm:text=>{message=text;return confirmed}},crypto,
  })
  const find=(node,predicate)=>Array.isArray(node) ? node.flatMap(n=>find(n,predicate)) : node && typeof node==='object' && node.props ? [...(predicate(node)?[node]:[]),...find(node.props.children,predicate)] : []
  const settings={professionalId:'owner',professionalName:'Fixture',slug:'fixture',enabled:true,blocks:structuredClone(blocks)}
  const writes=[]
  const render=(value=settings,saving=false)=>exports.default({
    settings:value,defaultSchedule:template,saving,mercadoPagoConnected:true,error:null,notice:null,onChange:()=>assert.fail('Deletion must not optimistically remove a turnera'),
    onSave:async value=>{writes.push(value);return false},onCopy:async()=>{},
  })
  const remove=find(render(),n=>n.type==='button' && n.props.children==='Eliminar turnera')
  assert.equal(remove.length,4)
  confirmed=false;remove[0].props.onClick()
  assert.equal(writes.length,0)
  confirmed=true;remove[0].props.onClick()
  assert.equal(writes.length,1)
  assert.match(message,/IOMA/)
  assert.match(message,/pagos pendientes se conservarán/)
  assert.deepEqual(Array.from(writes[0].blocks,b=>b.id),['pami','private-a','private-b'])
  assert.equal(writes[0].enabled,true)
  assert.equal(settings.blocks.length,4)
  assert.equal(find(render(),n=>n.type==='button' && n.props.children==='Eliminar turnera').length,4)
  find(render({...settings,blocks:[blocks[0]]}),n=>n.type==='button' && n.props.children==='Eliminar turnera')[0].props.onClick()
  assert.equal(writes[1].blocks.length,0)
  assert.equal(writes[1].enabled,false)
  find(render({...settings,enabled:false}),n=>n.type==='button' && n.props.children==='Eliminar turnera')[0].props.onClick()
  assert.equal(writes[2].enabled,false)
  find(render(settings,true),n=>n.type==='button' && n.props.children==='Eliminar turnera')[0].props.onClick()
  assert.equal(writes.length,3)
})

test('individual links use stable block IDs while legacy routes remain unchanged', async()=>{
  const source=await readFile(new URL('../src/publicBookingService.ts',import.meta.url),'utf8')
  const exports={}
  vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}),{
    exports,require:()=>({}),window:{location:{origin:'https://fixture.invalid',pathname:'/index.html'}},
  })
  assert.equal(exports.buildFixedPublicBookingUrl('doctor'),'https://fixture.invalid/turnera/doctor')
  assert.equal(exports.buildFixedPublicBookingUrl('doctor','coverage'),'https://fixture.invalid/turnera/doctor/gratis')
  assert.equal(exports.buildFixedPublicBookingUrl('doctor',undefined,'pami'),'https://fixture.invalid/turnera/doctor?b=pami')
})
