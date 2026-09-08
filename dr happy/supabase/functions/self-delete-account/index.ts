import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { corsHeaders } from '../_shared/cors.ts'

// Auto-eliminación de cuenta por el propio usuario (requisito de Google Play).
// Flujo idéntico a la baja administrativa: genera el archivo legal, lo envía
// por email al usuario y a archivolegal@drhappy.com.ar, y luego elimina la
// cuenta y sus datos asociados. Irreversible.
//
// Seguridad: exige la contraseña actual del usuario (bcrypt) para confirmar
// que es realmente él quien solicita la baja.

interface RequestBody {
  action: 'self-delete'
  userId?: string
  password?: string
}

const LEGAL_ARCHIVE_EMAIL = 'archivolegal@drhappy.com.ar'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
    return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
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
    if (body.action !== 'self-delete') {
      return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
    }

    const userId = body.userId?.trim()
    const password = body.password
    if (!userId || !password) {
      return jsonResponse(400, { success: false, message: 'Falta el usuario o la contraseña de confirmación.' })
    }

    // 1) Verificamos la contraseña del usuario (bcrypt) — solo él puede borrarse.
    const { data: professional, error: professionalError } = await admin
      .from('professionals')
      .select('id, username, full_name, dni, email, specialty, license_number, network_memberships_json, active, is_admin, trial_started_at, subscription_status, subscription_expires_at, password_hash')
      .eq('id', userId)
      .maybeSingle()

    if (professionalError || !professional) {
      return jsonResponse(404, { success: false, message: 'No se encontró la cuenta.' })
    }
    if (professional.is_admin === true) {
      return jsonResponse(400, { success: false, message: 'La cuenta de administrador no puede auto-eliminarse.' })
    }
    if (!professional.password_hash) {
      return jsonResponse(400, { success: false, message: 'Esta cuenta no tiene contraseña configurada para confirmar la baja.' })
    }

    const passwordOk = await bcrypt.compare(password, professional.password_hash)
    if (!passwordOk) {
      return jsonResponse(401, { success: false, message: 'La contraseña ingresada no es correcta.' })
    }

    // 2) Leemos el workspace y mensajes para el archivo legal.
    const [{ data: workspace }, { data: messagesData }] = await Promise.all([
      admin
        .from('user_workspaces')
        .select('user_id, profile_json, patients_json, appointments_json')
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('community_messages')
        .select('id, sender_id, recipient_id, text, attachments_json, sent_at')
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('sent_at', { ascending: true }),
    ])

    const patients = Array.isArray(workspace?.patients_json) ? workspace.patients_json : []
    const appointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json : []
    const messages = Array.isArray(messagesData) ? messagesData : []

    const nowIso = new Date().toISOString()
    const archiveData = {
      exportedAt: nowIso,
      deletedBy: {
        id: professional.id,
        username: professional.username,
        fullName: professional.full_name,
        email: professional.email,
        selfService: true,
      },
      user: {
        id: professional.id,
        username: professional.username,
        fullName: professional.full_name,
        dni: professional.dni ?? '',
        specialty: professional.specialty,
        licenseNumber: professional.license_number,
        email: professional.email,
        networkMemberships: professional.network_memberships_json ?? [],
        active: professional.active ?? true,
        trialStartedAt: professional.trial_started_at ?? null,
        subscriptionStatus: professional.subscription_status ?? null,
        subscriptionExpiresAt: professional.subscription_expires_at ?? null,
      },
      workspace: {
        profile: workspace?.profile_json ?? null,
        patients,
        appointments,
      },
      communityMessages: messages,
    }

    // 3) Guardamos el archivo legal en la tabla de archivos.
    const { error: archiveError } = await admin.from('deleted_user_archives').insert({
      deleted_user_id: professional.id,
      deleted_username: professional.username,
      deleted_full_name: professional.full_name,
      deleted_email: professional.email,
      deleted_dni: professional.dni ?? null,
      deleted_at: nowIso,
      deleted_by_user_id: professional.id,
      deleted_by_user_name: `${professional.full_name} (auto-eliminación)`,
      patient_count: patients.length,
      appointment_count: appointments.length,
      archive_json: archiveData,
    })
    if (archiveError) {
      return jsonResponse(500, { success: false, message: `No se pudo guardar el archivo legal: ${archiveError.message}` })
    }

    // 4) Enviamos el archivo legal por email (usuario + casilla legal).
    const fileNameSafe = `archivo-legal-${professional.username}-${nowIso.slice(0, 10)}.json`
    const emailPayload = {
      to: [professional.email, LEGAL_ARCHIVE_EMAIL],
      subject: `Archivo legal - ${professional.full_name} - DNI ${professional.dni ?? 'no informado'}`,
      text: `Se adjunta el archivo legal correspondiente a la eliminación de la cuenta de ${professional.full_name} (DNI ${professional.dni ?? 'no informado'}), solicitada por el propio usuario.`,
      type: 'legal_archive',
      attachments: [
        {
          filename: fileNameSafe,
          content: JSON.stringify(archiveData, null, 2),
          contentType: 'application/json',
        },
      ],
    }

    const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(emailPayload),
    })
    const emailResult = await emailResponse.json().catch(() => null)
    if (!emailResponse.ok || !emailResult?.success) {
      // Si falla el envío, NO eliminamos la cuenta: el archivo legal es obligatorio.
      return jsonResponse(500, {
        success: false,
        message: `No se pudo enviar el archivo legal por correo (${emailResult?.message ?? 'error desconocido'}). La cuenta no fue eliminada; intentá de nuevo o contactá soporte.`,
      })
    }

    // 5) Eliminamos los datos asociados y finalmente la cuenta.
    await admin.from('user_workspaces').delete().eq('user_id', userId)
    await admin.from('community_messages').delete().or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    await admin.from('user_push_subscriptions').delete().eq('user_id', userId)

    const { error: deleteError } = await admin.from('professionals').delete().eq('id', userId)
    if (deleteError) {
      return jsonResponse(500, { success: false, message: `No se pudo eliminar la cuenta: ${deleteError.message}` })
    }

    return jsonResponse(200, { success: true })
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servidor.',
    })
  }
})
