import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import nodemailer from 'npm:nodemailer@6.9.13'
import { corsHeaders } from '../_shared/cors.ts'

interface EmailPayload {
  to: string | string[]
  subject: string
  text?: string
  html?: string
  type?: 'welcome' | 'password_recovery' | 'password_changed' | 'admin_broadcast' | 'appointment' | 'custom'
  templateData?: Record<string, unknown>
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

function getBaseTemplate(title: string, innerHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; }
    .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 30px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; color: #bfdbfe; }
    .content { padding: 32px 28px; line-height: 1.65; font-size: 15px; }
    .code-box { background: #f8fafc; border: 2px dashed #3b82f6; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
    .code-val { font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #1e3a8a; font-family: Consolas, 'Courier New', monospace; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 20px 0; text-align: center; }
    .highlight-card { background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 6px; padding: 16px; margin: 20px 0; }
    .footer { background-color: #f8fafc; padding: 22px 24px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .footer a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Dr Happy 😊</h1>
      <p>Plataforma Médica y Gestión de Pacientes</p>
    </div>
    <div class="content">
      ${innerHtml}
    </div>
    <div class="footer">
      <p style="margin: 0 0 6px;">Este es un mensaje institucional enviado desde <strong>soporte@drhappy.com.ar</strong></p>
      <p style="margin: 0 0 10px;">Sitio oficial: <a href="https://drhappy.com.ar/" target="_blank">drhappy.com.ar</a></p>
      <p style="margin: 0; font-size: 12px; color: #94a3b8;">© ${new Date().getFullYear()} DrHappy. Todos los derechos reservados.</p>
    </div>
  </div>
</body>
</html>
  `
}

function buildHtmlForType(type: string | undefined, subject: string, templateData: Record<string, unknown> = {}, fallbackHtml?: string): string {
  if (fallbackHtml) {
    return fallbackHtml
  }

  switch (type) {
    case 'password_recovery': {
      const fullName = String(templateData.fullName || 'Estimado/a profesional')
      const code = String(templateData.code || '------')
      const expiresMinutes = String(templateData.expiresMinutes || '15')
      const inner = `
        <h2 style="color: #0f172a; margin-top: 0;">Recuperación de contraseña</h2>
        <p>Hola <strong>${fullName}</strong>,</p>
        <p>Recibimos una solicitud para restablecer tu clave de acceso a <strong>DrHappy</strong>. Ingresa el siguiente código de seguridad en la aplicación:</p>
        <div class="code-box">
          <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">Código de verificación</div>
          <div class="code-val">${code}</div>
        </div>
        <p style="color: #475569; font-size: 14px;">⏳ Este código tiene una validez de <strong>${expiresMinutes} minutos</strong>. Si tú no solicitaste este cambio, puedes desestimar este mensaje; tu contraseña actual permanecerá segura.</p>
        <div style="text-align: center; margin-top: 25px;">
          <a href="https://drhappy.com.ar/" class="btn" target="_blank">Ir a DrHappy</a>
        </div>
      `
      return getBaseTemplate('Código de recuperación - Dr Happy', inner)
    }

    case 'password_changed': {
      const fullName = String(templateData.fullName || 'Estimado/a profesional')
      const inner = `
        <h2 style="color: #0f172a; margin-top: 0;">Tu contraseña ha sido actualizada</h2>
        <p>Hola <strong>${fullName}</strong>,</p>
        <p>Te confirmamos que la contraseña de tu cuenta en <strong>DrHappy</strong> ha sido modificada con éxito.</p>
        <div class="highlight-card">
          <strong style="color: #1e40af; display: block; margin-bottom: 4px;">✅ Acceso listo</strong>
          <span>Ya puedes iniciar sesión en la plataforma con tu nueva contraseña desde cualquier dispositivo.</span>
        </div>
        <div style="text-align: center; margin-top: 25px;">
          <a href="https://drhappy.com.ar/" class="btn" target="_blank">Ingresar a mi cuenta</a>
        </div>
        <p style="color: #64748b; font-size: 13px; margin-top: 20px;">Si no realizaste este cambio, comunícate de inmediato con nuestro equipo de soporte en <a href="mailto:soporte@drhappy.com.ar">soporte@drhappy.com.ar</a>.</p>
      `
      return getBaseTemplate('Contraseña actualizada - Dr Happy', inner)
    }

    case 'welcome': {
      const fullName = String(templateData.fullName || 'Profesional de la Salud')
      const username = String(templateData.username || '')
      const specialty = String(templateData.specialty || 'Medicina General')
      const inner = `
        <h2 style="color: #0f172a; margin-top: 0;">¡Bienvenido/a a DrHappy! 🩺</h2>
        <p>Estimado/a <strong>${fullName}</strong>,</p>
        <p>Nos alegra darte la bienvenida a <strong>DrHappy</strong>, la plataforma integral diseñada para optimizar tu práctica médica diaria, historia clínica digital y protocolos de emergencia.</p>
        <div class="highlight-card">
          <strong style="color: #1e40af; display: block; margin-bottom: 8px;">Detalles de tu cuenta:</strong>
          <ul style="margin: 0; padding-left: 20px; color: #1e3a8a;">
            <li><strong>Usuario:</strong> @${username}</li>
            <li><strong>Especialidad:</strong> ${specialty}</li>
            <li><strong>Canal oficial de soporte:</strong> soporte@drhappy.com.ar</li>
          </ul>
        </div>
        <p>Desde la plataforma podrás:</p>
        <ul style="color: #475569; padding-left: 20px;">
          <li>Gestionar pacientes y fichas clínicas con backup seguro.</li>
          <li>Generar recetas médicas, certificados y pedidos con firma digital.</li>
          <li>Consultar el vademécum farmacológico y protocolos clínicos de urgencia.</li>
          <li>Interconsultas y comunidad privada entre colegas.</li>
        </ul>
        <div style="text-align: center; margin-top: 25px;">
          <a href="https://drhappy.com.ar/" class="btn" target="_blank">Comenzar a usar DrHappy</a>
        </div>
      `
      return getBaseTemplate('¡Bienvenido/a a DrHappy!', inner)
    }

    case 'admin_broadcast': {
      const recipientName = String(templateData.recipientName || 'Estimado/a colega')
      const messageBody = String(templateData.message || '')
      const inner = `
        <h2 style="color: #0f172a; margin-top: 0;">${subject}</h2>
        <p>Hola <strong>${recipientName}</strong>,</p>
        <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 20px; margin: 20px 0; color: #1e293b; font-size: 15px; white-space: pre-line;">
          ${messageBody}
        </div>
        <div style="text-align: center; margin-top: 25px;">
          <a href="https://drhappy.com.ar/" class="btn" target="_blank">Abrir DrHappy</a>
        </div>
      `
      return getBaseTemplate(subject, inner)
    }

    case 'appointment': {
      const patientName = String(templateData.patientName || 'Paciente')
      const professionalName = String(templateData.professionalName || 'Profesional tratante')
      const specialty = String(templateData.specialty || 'Consulta médica')
      const date = String(templateData.date || '')
      const time = String(templateData.time || '')
      const location = String(templateData.location || 'Consultorio')
      const notes = String(templateData.notes || '')
      const inner = `
        <h2 style="color: #0f172a; margin-top: 0;">Confirmación de Turno Médico 📅</h2>
        <p>Hola <strong>${patientName}</strong>,</p>
        <p>Te confirmamos los detalles de tu turno programado en <strong>DrHappy</strong>:</p>
        <div class="highlight-card">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600; width: 140px;">Profesional:</td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 700;">${professionalName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Especialidad:</td>
              <td style="padding: 6px 0; color: #0f172a;">${specialty}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Fecha:</td>
              <td style="padding: 6px 0; color: #1e40af; font-weight: 700;">${date}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Hora:</td>
              <td style="padding: 6px 0; color: #1e40af; font-weight: 700;">${time} hs</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Lugar:</td>
              <td style="padding: 6px 0; color: #0f172a;">${location}</td>
            </tr>
            ${notes ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Indicaciones:</td>
              <td style="padding: 6px 0; color: #0f172a;">${notes}</td>
            </tr>` : ''}
          </table>
        </div>
        <p style="color: #64748b; font-size: 13px;">Por favor preséntate 10 minutos antes del horario pactado con tu documento de identidad y carnet de cobertura médica.</p>
        <div style="text-align: center; margin-top: 25px;">
          <a href="https://drhappy.com.ar/" class="btn" target="_blank">Ver en DrHappy</a>
        </div>
      `
      return getBaseTemplate('Confirmación de Turno - Dr Happy', inner)
    }

    default: {
      const inner = `
        <h2 style="color: #0f172a; margin-top: 0;">${subject}</h2>
        <div style="color: #334155; line-height: 1.6;">
          ${String(templateData.message || '')}
        </div>
      `
      return getBaseTemplate(subject, inner)
    }
  }
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { message: 'Método no permitido.' })
  }

  const smtpHost = Deno.env.get('SMTP_HOST')?.trim() || 'smtp.hostinger.com'
  const smtpPort = Number(Deno.env.get('SMTP_PORT')?.trim() || '465')
  const smtpUser = Deno.env.get('SMTP_USER')?.trim() || 'soporte@drhappy.com.ar'
  const smtpPass = Deno.env.get('SMTP_PASSWORD')?.trim() || Deno.env.get('HOSTINGER_MAIL_PASSWORD')?.trim() || ''
  const fromName = Deno.env.get('SMTP_FROM_NAME')?.trim() || 'Dr Happy'
  const fromEmail = Deno.env.get('SMTP_FROM_EMAIL')?.trim() || 'soporte@drhappy.com.ar'

  let payload: EmailPayload
  try {
    payload = await request.json()
  } catch {
    return jsonResponse(400, { message: 'Cuerpo JSON inválido.' })
  }

  const { to, subject, text, html, type, templateData } = payload

  if (!to || (!Array.isArray(to) && !String(to).trim()) || !subject) {
    return jsonResponse(400, { message: 'Campos "to" y "subject" son requeridos.' })
  }

  if (!smtpPass) {
    return jsonResponse(500, {
      success: false,
      message: 'Falta configurar la contraseña SMTP (secret SMTP_PASSWORD) en Supabase para soporte@drhappy.com.ar.',
      hint: 'Por favor asigna la contraseña de la casilla de correo en Hostinger a SMTP_PASSWORD.',
      configuredUser: smtpUser,
      configuredHost: smtpHost,
    })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    })

    const finalHtml = buildHtmlForType(type, subject, templateData, html)
    const finalRecipient = Array.isArray(to) ? to.join(', ') : to

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: finalRecipient,
      subject: subject,
      text: text || subject,
      html: finalHtml,
    })

    return jsonResponse(200, {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    })
  } catch (error) {
    console.error('Error enviando email vía SMTP Hostinger:', error)
    return jsonResponse(500, {
      success: false,
      message: `Error enviando correo: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
})
