import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { consultationCorrectionError, correctionReplacementError, correctionSignedContent } from '../../../src/consultationCorrection.ts'
import type { SignedConsultation } from '../../../src/consultationCorrection.ts'
import { verifySignatureSeal } from '../../../src/signatureSeal.ts'

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('Falta configuración del servidor.')
    const admin = createClient(url, key, { auth: { persistSession: false } })
    const professionalId = await resolveProfessionalId(request, admin)
    if (!professionalId) return reply(401, { success: false, message: 'Sesión profesional requerida.' })
    let body
    try { body = await request.json() }
    catch { return reply(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
    if (!body || typeof body.patientId !== 'string' || typeof body.consultationId !== 'string'
      || typeof body.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedHash)
      || !body.replacement || typeof body.replacement !== 'object' || JSON.stringify(body.replacement).length > 500_000) {
      return reply(400, { success: false, message: 'Solicitud de corrección inválida.' })
    }
    const { data, error } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    if (error) throw new Error('No se pudo consultar la evolución.')
    const patient = data?.patients_json?.find((item: { id?: string }) => item.id === body.patientId)
    const original: SignedConsultation | undefined = patient?.consultations?.find((item: SignedConsultation) => item.id === body.consultationId)
    if (!original) return reply(404, { success: false, message: 'No se encontró la evolución guardada.' })
    const blocked = consultationCorrectionError(original, professionalId)
    if (blocked) return reply(409, { success: false, message: blocked })
    if (original.signatureSeal?.hashSha256 !== body.expectedHash) return reply(409, { success: false, message: 'La evolución ya fue corregida. Recargá la ficha antes de reintentar.' })
    const replacement: SignedConsultation = body.replacement
    if (correctionReplacementError(original, replacement, body.expectedHash)
      || replacement.id !== original.id || replacement.date !== original.date
      || !replacement.motivoConsulta?.trim() || !replacement.correction?.reason?.trim()
      || replacement.correction.reason.length > 1000 || replacement.correction.previousHash !== body.expectedHash
      || replacement.correction.originalDate !== original.date || !replacement.signatureSeal
      || replacement.signatureSeal.signedByUserId !== professionalId
      || replacement.signatureSeal.signedByFullName !== replacement.professionalSignature?.fullName
      || replacement.signatureSeal.signedByLicense !== replacement.professionalSignature?.licenseNumber
      || !Number.isFinite(Date.parse(replacement.signatureSeal.signedAt))
      || Math.abs(Date.now() - Date.parse(replacement.signatureSeal.signedAt)) > 5 * 60_000
      || !await verifySignatureSeal({ contentToVerify: correctionSignedContent(patient.id, patient.dni || '', replacement), seal: replacement.signatureSeal })) {
      return reply(400, { success: false, message: 'La corrección o su nueva firma no son válidas.' })
    }
    const { data: saved, error: saveError } = await admin.rpc('correct_clinical_consultation', {
      p_professional_id: professionalId, p_patient_id: patient.id, p_consultation_id: original.id,
      p_expected_hash: body.expectedHash, p_replacement: replacement,
    })
    if (saveError) {
      if (['22023', '42501', 'P0002', '40001', '23505'].includes(saveError.code)) return reply(409, { success: false, message: saveError.message })
      throw new Error('No se pudo guardar la corrección.')
    }
    return reply(200, { success: true, consultation: saved })
  } catch (error) {
    console.error('[consultation-correction] No se pudo confirmar la corrección', { message: error instanceof Error ? error.message : 'Error desconocido' })
    return reply(500, { success: false, message: 'No se pudo confirmar la corrección. Recargá la ficha antes de reintentar.' })
  }
})
