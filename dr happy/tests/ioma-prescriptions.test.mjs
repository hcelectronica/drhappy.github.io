import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await readFile(new URL('../supabase/functions/ioma-prescriptions/index.ts', import.meta.url), 'utf8')
function fixture({ identity = 'owner', emailFailure = false, insertFailure = false } = {}) {
  const writes = [], mails = [], calls = []
  const admin = {
    rpc: async (name, value) => { calls.push({ name, value }); return { data: true, error: insertFailure ? { code: 'test' } : null } },
    from(table) {
      let action = 'select'
      const filters = {}
      const query = {
        select() { return query }, update(value) { action = 'update'; writes.push({ table, value }); return query },
        upsert(value) { action = 'upsert'; writes.push({ table, value }); return query },
        eq(key, value) { filters[key] = value; return query }, gt() { return query }, in() { return query },
        maybeSingle() { return query }, order() { return query }, limit() { return query },
        then(resolve, reject) {
          const records = {
            professionals: { full_name:'Fixture',email:'doctor@example.invalid',active:true },
            user_workspaces: { profile_json:{} },
            ioma_prescription_settings: { enabled:true },
            ioma_prescription_requests: filters.professional_id === 'other' ? null : { id: filters.id },
          }
          return Promise.resolve({ data: action === 'select' ? records[table] : null, error:null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  let handler
  const js = ts.transpile(source.replace(/^import .*$/gm, ''), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  vm.runInNewContext(js, {
    Deno:{ serve: fn => {handler=fn}, env:{get:()=> 'fixture'} }, createClient:()=>admin,
    corsHeaders:{}, resolveProfessionalId:async()=>identity, findPublicAliasOwner:async()=> 'owner',
    ensurePublicAlias:async()=> 'fixture', hasMedicalToolRowAccess:()=>true, MEDICAL_TOOL_ACCESS_COLUMNS:'active',
    Request, Response, crypto, Date, TextDecoder, Uint8Array, atob, btoa, AbortSignal,
    console:{error(){}}, fetch:async (_url, init)=>{mails.push(JSON.parse(init.body)); return Response.json({success:!emailFailure})},
  })
  return { calls, writes, mails, async call(body) {
    const response = await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)}))
    return { status:response.status, body:await response.json() }
  } }
}
const request = {action:'submit',slug:'fixture',patientFirstName:'Paciente',patientLastName:'Prueba',
  patientDni:'12345678',patientEmail:'patient@example.invalid',patientPhone:'11111111',birthDate:'1990-01-01',
  insuranceMemberNumber:'1234',medication:'Medicación de prueba',consent:true,website:''}

test('free request stores once, notifies professional without credential or clinical data', async()=>{
  const h=fixture()
  const result=await h.call(request)
  assert.equal(result.status,200)
  assert.equal(result.body.emailSent,true)
  assert.equal(h.calls[0].name,'create_ioma_prescription_request')
  assert.equal('p_image' in h.calls[0].value,false)
  assert.equal(h.mails[0].to,'doctor@example.invalid')
  assert(!JSON.stringify(h.mails).includes(request.medication))
  assert.equal(h.writes[0].value.email_status,'sent')
})
test('failed email leaves request saved and reports failure',async()=>{
  const h=fixture({emailFailure:true}), result=await h.call(request)
  assert.equal(result.body.success,true)
  assert.equal(result.body.emailSent,false)
  assert.equal(h.writes[0].value.email_status,'failed')
})
test('images and tokens are rejected, and failed saves do not send mail',async()=>{
  const invalid=fixture(), bad=await invalid.call({...request,image:{type:'image/png',base64:'YWJj'}})
  assert.equal(bad.status,400); assert.equal(invalid.calls.length,0); assert.equal(invalid.mails.length,0)
  assert.equal((await invalid.call({...request,token:'fixture'})).status,400)
  const failed=fixture({insertFailure:true}), result=await failed.call(request)
  assert.equal(result.status,503); assert.equal(failed.mails.length,0)
})
test('completion requires a professional session',async()=>{
  const anonymous=fixture({identity:null})
  assert.equal((await anonymous.call({action:'complete',id:'f4e3e15f-a43f-4713-9b86-a6ea9c0f8b20'})).status,401)
  const owner=fixture()
  const result=await owner.call({action:'complete',id:'f4e3e15f-a43f-4713-9b86-a6ea9c0f8b20'})
  assert.equal(result.body.success,true)
  assert.equal(owner.calls[0].value.p_professional_id,'owner')
})
