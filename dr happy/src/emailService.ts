import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  text?: string
  html?: string
  type?: 'welcome' | 'password_recovery' | 'password_changed' | 'admin_broadcast' | 'appointment' | 'custom'
  templateData?: Record<string, unknown>
}

export interface SendEmailResult {
  success: boolean
  message?: string
  messageId?: string
}

/**
 * Sends an email using the Supabase Edge Function connected to Hostinger SMTP (soporte@drhappy.com.ar).
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!isSupabaseConfigured || !supabase) {
    console.warn('[emailService] Supabase no está configurado; no se puede enviar email por SMTP.', options)
    return {
      success: false,
      message: 'Supabase no está conectado en este entorno.',
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: options,
    })

    if (error) {
      console.error('[emailService] Error invocando función send-email:', error)
      return {
        success: false,
        message: error.message || 'Error invocando el servicio de correo.',
      }
    }

    if (data && typeof data === 'object') {
      const resp = data as { success?: boolean; message?: string; messageId?: string }
      if (resp.success === false) {
        return {
          success: false,
          message: resp.message || 'El servidor SMTP rechazó el envío.',
        }
      }
      return {
        success: true,
        messageId: resp.messageId,
      }
    }

    return {
      success: true,
    }
  } catch (err) {
    console.error('[emailService] Error inesperado enviando email:', err)
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Helper: Envía correo de bienvenida a un profesional recién registrado.
 */
export async function sendWelcomeEmail(params: {
  to: string
  fullName: string
  username: string
  specialty: string
}): Promise<SendEmailResult> {
  return sendEmail({
    to: params.to,
    subject: '¡Bienvenido/a a DrHappy! 🩺 Tu cuenta ha sido creada',
    type: 'welcome',
    templateData: {
      fullName: params.fullName,
      username: params.username,
      specialty: params.specialty,
    },
  })
}

/**
 * Helper: Envía el código de 6 dígitos para restablecer contraseña.
 */
export async function sendPasswordRecoveryEmail(params: {
  to: string
  fullName: string
  code: string
  expiresMinutes?: number
}): Promise<SendEmailResult> {
  return sendEmail({
    to: params.to,
    subject: `Dr Happy 😊 Código de recuperación: ${params.code}`,
    type: 'password_recovery',
    templateData: {
      fullName: params.fullName,
      code: params.code,
      expiresMinutes: params.expiresMinutes || 15,
    },
  })
}

/**
 * Helper: Envía confirmación de que la contraseña fue actualizada.
 */
export async function sendPasswordChangedEmail(params: {
  to: string
  fullName: string
}): Promise<SendEmailResult> {
  return sendEmail({
    to: params.to,
    subject: 'Dr Happy 😊 Tu contraseña fue actualizada con éxito',
    type: 'password_changed',
    templateData: {
      fullName: params.fullName,
    },
  })
}

/**
 * Helper: Envía un comunicado institucional a uno o múltiples correos.
 */
export async function sendAdminBroadcastEmail(params: {
  to: string | string[]
  subject: string
  message: string
  recipientName?: string
}): Promise<SendEmailResult> {
  return sendEmail({
    to: params.to,
    subject: params.subject.trim() || 'Comunicado institucional de DrHappy',
    type: 'admin_broadcast',
    templateData: {
      message: params.message,
      recipientName: params.recipientName || 'Estimado/a profesional',
    },
  })
}

/**
 * Helper: Envía confirmación de turno agendado (para cuando la turnera esté activa).
 */
export async function sendAppointmentEmail(params: {
  to: string
  patientName: string
  professionalName: string
  specialty: string
  date: string
  time: string
  location?: string
  notes?: string
}): Promise<SendEmailResult> {
  return sendEmail({
    to: params.to,
    subject: `Turno confirmado con ${params.professionalName} - ${params.date} ${params.time} hs`,
    type: 'appointment',
    templateData: {
      patientName: params.patientName,
      professionalName: params.professionalName,
      specialty: params.specialty,
      date: params.date,
      time: params.time,
      location: params.location || 'Consultorio médico',
      notes: params.notes || '',
    },
  })
}
