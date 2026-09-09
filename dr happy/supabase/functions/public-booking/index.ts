import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Función NUEVA e independiente de la Turnera existente.
// Permite a un profesional generar un enlace público de "turnos libres"
// (con cupo y rango horario que él mismo regula) para compartir por
// WhatsApp con un paciente que todavía no está registrado. El paciente
// entra al enlace, ve los horarios disponibles, elige uno y completa sus
// datos básicos. Al confirmar, el turno se agrega automáticamente a la
// Turnera global del profesional (tabla user_workspaces.appointments_json),
// exactamente igual que si el profesional lo hubiese cargado a mano.
//
// Acciones (action):
// - create-link:   el profesional autenticado genera un nuevo enlace con
//                   fecha, rango horario, cantidad de turnos y lugar/motivo.
// - get-link:      público; devuelve datos del enlace y los horarios
//                   disponibles/ocupados (sin datos sensibles de otros
//                   pacientes).
// - book-slot:     público; el paciente elige un horario y envía sus datos.
//                   Crea el turno en user_workspaces.appointments_json.
// - list-links:    el profesional autenticado lista sus enlaces activos.
// - cancel-link:   el profesional autenticado cancela un enlace.

interface RequestBody {
  action: 'create-link' | 'get-link' | 'book-slot' | 'list-links' | 'cancel-link'
  professionalId?: string
  professionalName?: string
  slotDate?: string
  startTime?: string
  endTime?: string
  slotCount?: number
  location?: string
  reason?: string
  intervalMinutes?: number
  token?: string
  slotTime?: string
  patientName?: string
  patientDni?: string
  patientEmail?: string
  patientPhone?: string
  linkId?: string
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Genera horarios distribuidos uniformemente entre startTime y endTime,
// tantos como slotCount indique (o cada intervalMinutes si se especifica).
function buildSlotTimes(startTime: string, endTime: string, slotCount: number, intervalMinutes?: number): string[] {
  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  const totalRange = Math.max(endMinutes - startMinutes, 0)

  const step = intervalMinutes && intervalMinutes > 0
    ? intervalMinutes
    : slotCount > 1
      ? Math.floor(totalRange / slotCount)
      : totalRange

  const times: string[] = []
  let cursor = startMinutes
  while (times.length < slotCount && cursor < endMinutes) {
    const h = Math.floor(cursor / 60)
    const m = cursor % 60
    times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    cursor += step > 0 ? step : 1
  }
  return times
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      success: false,
      message: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en los secrets de la función.',
    })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  try {
    switch (body.action) {
      case 'create-link': {
        const professionalId = body.professionalId?.trim()
        const slotDate = body.slotDate?.trim()
        const startTime = body.startTime?.trim()
        const endTime = body.endTime?.trim()
        const slotCount = Number(body.slotCount)

        if (!professionalId || !slotDate || !startTime || !endTime || !slotCount) {
          return jsonResponse(400, {
            success: false,
            message: 'Faltan datos para crear el enlace (fecha, horario o cantidad de turnos).',
          })
        }
        if (slotCount < 1 || slotCount > 50) {
          return jsonResponse(400, { success: false, message: 'La cantidad de turnos debe ser entre 1 y 50.' })
        }
        if (startTime >= endTime) {
          return jsonResponse(400, { success: false, message: 'El horario de inicio debe ser anterior al de fin.' })
        }

        const token = generateToken()
        const rawAmount = Number(body.amountToCharge)
        const hasAmount = Number.isFinite(rawAmount) && rawAmount > 0
        const { data: link, error: linkError } = await admin
          .from('public_booking_links')
          .insert({
            token,
            professional_id: professionalId,
            professional_name: body.professionalName?.trim() ?? null,
            slot_date: slotDate,
            start_time: startTime,
            end_time: endTime,
            slot_count: slotCount,
            location: body.location?.trim() ?? null,
            reason: body.reason?.trim() ?? null,
            amount_to_charge: hasAmount ? rawAmount : null,
            amount_concept: hasAmount ? (body.amountConcept === 'sena' ? 'sena' : 'consulta') : null,
            payment_link: hasAmount ? (body.paymentLink?.trim() || null) : null,
            status: 'active',
          })
          .select('id, token')
          .single()

        if (linkError || !link) {
          return jsonResponse(500, { success: false, message: `No se pudo crear el enlace: ${linkError?.message}` })
        }

        const slotTimes = buildSlotTimes(startTime, endTime, slotCount, body.intervalMinutes)
        const slotsToInsert = slotTimes.map((slotTime) => ({
          link_id: link.id,
          slot_time: slotTime,
          is_booked: false,
        }))

        const { error: slotsError } = await admin.from('public_booking_slots').insert(slotsToInsert)
        if (slotsError) {
          await admin.from('public_booking_links').delete().eq('id', link.id)
          return jsonResponse(500, { success: false, message: `No se pudieron crear los turnos: ${slotsError.message}` })
        }

        return jsonResponse(200, { success: true, token: link.token, slotCount: slotsToInsert.length })
      }

      case 'list-links': {
        const professionalId = body.professionalId?.trim()
        if (!professionalId) {
          return jsonResponse(400, { success: false, message: 'Falta el identificador del profesional.' })
        }
        const { data: links, error } = await admin
          .from('public_booking_links')
          .select('id, token, slot_date, start_time, end_time, slot_count, location, reason, status, created_at')
          .eq('professional_id', professionalId)
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }

        const linkIds = (links ?? []).map((l) => l.id)
        let slotsByLink: Record<string, { total: number; booked: number }> = {}
        if (linkIds.length > 0) {
          const { data: slots } = await admin
            .from('public_booking_slots')
            .select('link_id, is_booked')
            .in('link_id', linkIds)
          slotsByLink = (slots ?? []).reduce((acc: Record<string, { total: number; booked: number }>, s) => {
            const entry = acc[s.link_id] ?? { total: 0, booked: 0 }
            entry.total += 1
            if (s.is_booked) entry.booked += 1
            acc[s.link_id] = entry
            return acc
          }, {})
        }

        const enriched = (links ?? []).map((l) => ({
          ...l,
          totalSlots: slotsByLink[l.id]?.total ?? l.slot_count,
          bookedSlots: slotsByLink[l.id]?.booked ?? 0,
        }))

        return jsonResponse(200, { success: true, links: enriched })
      }

      case 'cancel-link': {
        const linkId = body.linkId?.trim()
        const professionalId = body.professionalId?.trim()
        if (!linkId || !professionalId) {
          return jsonResponse(400, { success: false, message: 'Faltan datos para cancelar el enlace.' })
        }
        const { error } = await admin
          .from('public_booking_links')
          .update({ status: 'cancelled' })
          .eq('id', linkId)
          .eq('professional_id', professionalId)
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        return jsonResponse(200, { success: true })
      }

      case 'get-link': {
        const token = body.token?.trim()
        if (!token) {
          return jsonResponse(400, { success: false, message: 'Falta el token del enlace.' })
        }
        const { data: link, error } = await admin
          .from('public_booking_links')
          .select('id, professional_name, slot_date, start_time, end_time, location, reason, status, amount_to_charge, amount_concept, payment_link')
          .eq('token', token)
          .maybeSingle()
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        if (!link || link.status !== 'active') {
          return jsonResponse(404, { success: false, message: 'Este enlace de turnos ya no está disponible.' })
        }

        const { data: slots, error: slotsError } = await admin
          .from('public_booking_slots')
          .select('id, slot_time, is_booked')
          .eq('link_id', link.id)
          .order('slot_time', { ascending: true })
        if (slotsError) {
          return jsonResponse(500, { success: false, message: slotsError.message })
        }

        return jsonResponse(200, {
          success: true,
          link: {
            professionalName: link.professional_name,
            slotDate: link.slot_date,
            location: link.location,
            reason: link.reason,
            amountToCharge: link.amount_to_charge,
            amountConcept: link.amount_concept,
            paymentLink: link.payment_link,
          },
          slots: (slots ?? []).map((s) => ({ id: s.id, time: s.slot_time, available: !s.is_booked })),
        })
      }

      case 'book-slot': {
        const token = body.token?.trim()
        const slotTime = body.slotTime?.trim()
        const patientName = body.patientName?.trim()
        const patientDni = body.patientDni?.trim()
        const patientEmail = body.patientEmail?.trim() ?? ''
        const patientPhone = body.patientPhone?.trim() ?? ''

        if (!token || !slotTime || !patientName || !patientDni) {
          return jsonResponse(400, {
            success: false,
            message: 'Completa nombre, DNI y elige un horario para confirmar el turno.',
          })
        }

        const { data: link, error: linkError } = await admin
          .from('public_booking_links')
          .select('id, professional_id, slot_date, location, reason, status, amount_to_charge, amount_concept, payment_link')
          .eq('token', token)
          .maybeSingle()
        if (linkError) {
          return jsonResponse(500, { success: false, message: linkError.message })
        }
        if (!link || link.status !== 'active') {
          return jsonResponse(404, { success: false, message: 'Este enlace de turnos ya no está disponible.' })
        }

        const { data: slot, error: slotError } = await admin
          .from('public_booking_slots')
          .select('id, is_booked')
          .eq('link_id', link.id)
          .eq('slot_time', slotTime)
          .maybeSingle()
        if (slotError || !slot) {
          return jsonResponse(404, { success: false, message: 'El horario elegido no existe.' })
        }
        if (slot.is_booked) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado por otro paciente. Elegí otro disponible.' })
        }

        const appointmentId = crypto.randomUUID()
        const nowIso = new Date().toISOString()

        // Marca el slot como reservado (condición atómica: sólo si seguía libre).
        const { data: updatedSlot, error: updateError } = await admin
          .from('public_booking_slots')
          .update({
            is_booked: true,
            patient_name: patientName,
            patient_dni: patientDni,
            patient_email: patientEmail || null,
            patient_phone: patientPhone || null,
            appointment_id: appointmentId,
            booked_at: nowIso,
          })
          .eq('id', slot.id)
          .eq('is_booked', false)
          .select('id')
          .maybeSingle()

        if (updateError || !updatedSlot) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado por otro paciente. Elegí otro disponible.' })
        }

        // Inserta el turno directamente en la Turnera global del profesional
        // (misma estructura que usa la app: user_workspaces.appointments_json).
        const { data: workspace, error: workspaceError } = await admin
          .from('user_workspaces')
          .select('user_id, appointments_json')
          .eq('user_id', link.professional_id)
          .maybeSingle()
        if (workspaceError) {
          return jsonResponse(500, { success: false, message: `No se pudo acceder a la agenda del profesional: ${workspaceError.message}` })
        }

        const currentAppointments = Array.isArray(workspace?.appointments_json) ? workspace!.appointments_json : []
        const newAppointment = {
          id: appointmentId,
          patientId: crypto.randomUUID(),
          patientName,
          patientEmail,
          patientDni,
          scheduledDate: link.slot_date,
          scheduledTime: slotTime,
          scheduledAt: `${link.slot_date}T${slotTime}:00`,
          reason: link.reason || 'Turno reservado por el paciente (turnos libres)',
          notes: patientPhone ? `Teléfono de contacto: ${patientPhone}` : '',
          location: link.location || 'Consultorio médico',
          status: 'pending',
          createdAt: nowIso,
          createdByUserId: link.professional_id,
          ...(link.amount_to_charge
            ? {
                amountToCharge: Number(link.amount_to_charge),
                amountConcept: link.amount_concept === 'sena' ? 'sena' : 'consulta',
              }
            : {}),
        }

        const nextAppointments = [...currentAppointments, newAppointment]

        const { error: upsertError } = await admin.from('user_workspaces').upsert(
          { user_id: link.professional_id, appointments_json: nextAppointments },
          { onConflict: 'user_id' },
        )
        if (upsertError) {
          return jsonResponse(500, { success: false, message: `No se pudo agendar el turno: ${upsertError.message}` })
        }

        return jsonResponse(200, {
          success: true,
          appointment: {
            date: link.slot_date,
            time: slotTime,
            location: link.location,
            amountToCharge: link.amount_to_charge ? Number(link.amount_to_charge) : null,
            amountConcept: link.amount_concept ?? null,
            paymentLink: link.payment_link ?? null,
          },
        })
      }

      default:
        return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
    }
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servidor.',
    })
  }
})
