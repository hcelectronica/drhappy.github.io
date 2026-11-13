import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { ensurePublicAlias, resolvePublicToolSettings } from '../supabase/functions/_shared/professionalPublicAlias.ts'
import { publicDocumentPaths } from '../supabase/functions/_shared/publicLinkPaths.ts'

const exports = {}
const linksCode = await readFile(new URL('../src/professionalPublicLinks.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpile(linksCode, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), {
  exports, require: () => ({ publicDocumentPaths }),
})
const { buildProfessionalPublicUrl, buildProfessionalDocumentUrl, parsePublicDocumentPath } = exports

function fixture() {
  const records = {
    professional_public_aliases: [
      { alias: 'doctor', professional_id: 'owner', is_primary: true },
      { alias: 'old-doctor', professional_id: 'owner', is_primary: false },
      { alias: 'other', professional_id: 'foreign', is_primary: true },
    ],
    professionals: [{ id: 'owner', active: true }, { id: 'foreign', active: true }],
    patient_invite_links: [{ professional_id: 'owner', token: 'legacy-invite-123456' }],
    public_booking_profiles: [{ professional_id: 'owner', slug: 'legacy-booking-123456', enabled: true }],
    paid_clinical_document_settings: [{ professional_id: 'owner', slug: 'legacy-documents-123456' }],
    virtual_consult_settings: [{ professional_id: 'owner', slug: 'legacy-consult-123456', enabled: true }],
  }
  const state = { fail: false }
  const admin = {
    async rpc(name, params) {
      assert.equal(name, 'ensure_professional_public_alias')
      return { data: records.professional_public_aliases.find(row => row.professional_id === params.p_professional_id && row.is_primary)?.alias, error: null }
    },
    from(table) {
      const filters = []
      const query = {
        select() { return query },
        eq(key, value) { filters.push(row => row[key] === value); return query },
        async maybeSingle() {
          return { data: records[table].find(row => filters.every(filter => filter(row))) ?? null,
            error: state.fail ? new Error('database unavailable') : null }
        },
      }
      return query
    },
  }
  return { records, state, admin }
}

test('one alias resolves current internal identifiers without exposing or modifying invite tokens', async () => {
  const h = fixture()
  const original = structuredClone(h.records)
  assert.equal(await ensurePublicAlias(h.admin, 'owner'), 'doctor')
  for (const table of ['public_booking_profiles', 'paid_clinical_document_settings', 'virtual_consult_settings', 'patient_invite_links']) {
    const field = table === 'patient_invite_links' ? 'token' : 'slug'
    const originalIdentifier = h.records[table][0][field]
    for (const identifier of ['doctor', 'old-doctor', originalIdentifier]) {
      const resolved = await resolvePublicToolSettings(h.admin, table, '*', identifier, field)
      assert.equal(resolved.professional_id, 'owner')
      assert.equal(resolved[field], originalIdentifier)
    }
    assert.equal(await resolvePublicToolSettings(h.admin, table, '*', 'other', field), null)
    assert.equal(await resolvePublicToolSettings(h.admin, table, '*', 'unknown', field), null)
  }
  assert.deepEqual(h.records, original)
  h.records.patient_invite_links[0].token = 'replacement-invite'
  assert.equal((await resolvePublicToolSettings(h.admin, 'patient_invite_links', '*', 'doctor', 'token')).token, 'replacement-invite')
  assert.equal(await resolvePublicToolSettings(h.admin, 'patient_invite_links', '*', 'legacy-invite-123456', 'token'), null)
})

test('conflicting legacy identifiers, inactive owners and database errors fail closed', async () => {
  const h = fixture()
  h.records.public_booking_profiles.push({ professional_id: 'foreign', slug: 'doctor', enabled: true })
  assert.equal(await resolvePublicToolSettings(h.admin, 'public_booking_profiles', '*', 'doctor'), null)
  h.records.professionals[0].active = false
  assert.equal(await resolvePublicToolSettings(h.admin, 'patient_invite_links', '*', 'doctor', 'token'), null)
  h.state.fail = true
  await assert.rejects(resolvePublicToolSettings(h.admin, 'public_booking_profiles', '*', 'doctor'), /database unavailable/)
})

test('canonical document paths select the correct service; unsupported paths do not fall into another tool', () => {
  for (const [type, path] of [['certificate', 'certificados'], ['fitness', 'aptos-fisicos'], ['prescription', 'recetas']]) {
    assert.equal(buildProfessionalDocumentUrl('doctor', type), `https://www.drhappy.com.ar/documentos/doctor/${path}`)
    assert.deepEqual(JSON.parse(JSON.stringify(parsePublicDocumentPath(`/documentos/doctor/${path}`))), { slug: 'doctor', serviceType: type })
  }
  assert.deepEqual(JSON.parse(JSON.stringify(parsePublicDocumentPath('/documentos/legacy-documents-123456/'))), { slug: 'legacy-documents-123456' })
  for (const path of ['/documentos/doctor/unknown', '/documentos/doctor/recetas/extra', '/documentos/%2F/recetas', '/registro/doctor', '/documentos/%ZZ']) {
    assert.equal(parsePublicDocumentPath(path), null)
  }
  assert.equal(buildProfessionalPublicUrl('registro', 'doctor'), 'https://www.drhappy.com.ar/registro/doctor')
  assert.equal(buildProfessionalPublicUrl('turnera', 'doctor', 'turno-ioma'), 'https://www.drhappy.com.ar/turnera/doctor/turno-ioma')
})

test('migration locks and isolates shared aliases while retaining historical addresses and untouched tool settings', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261112010000_unified_professional_public_aliases.sql', import.meta.url), 'utf8')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.professional_public_aliases FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /WHERE professional_id = p_professional_id AND is_primary/)
  assert.match(sql, /SET is_primary = false/)
  assert.equal(/(?:DELETE FROM|UPDATE)\s+public\.(?:public_booking_profiles|paid_clinical_document_settings|virtual_consult_settings|patient_invite_links)\b/.test(sql), false)
  assert.equal(/INSERT INTO public\.(?:public_booking_profiles|patient_receptions|patient_invite_links)\b/.test(sql), false)
  for (const table of ['public_booking_profiles', 'paid_clinical_document_settings', 'virtual_consult_settings', 'patient_invite_links']) {
    assert.ok(sql.includes(`ON public.${table}`))
  }
})
