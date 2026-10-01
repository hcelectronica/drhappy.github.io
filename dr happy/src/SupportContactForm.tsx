import { useState } from 'react'
import type { FormEvent } from 'react'
import { SUPPORT_MESSAGE_MAX_LENGTH, sendSupportMessage } from './supportService'

interface SupportContactFormProps {
  defaultName?: string
  defaultEmail?: string
}

export function SupportContactForm({ defaultName = '', defaultEmail = '' }: SupportContactFormProps) {
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setStatus(null)
    const result = await sendSupportMessage({ name: name.trim(), email: email.trim(), message: message.trim(), website })
    setBusy(false)
    if (result.success) {
      setMessage('')
      setStatus({ ok: true, text: '¡Gracias! Recibimos tu mensaje y te vamos a responder por email.' })
    } else {
      setStatus({ ok: false, text: result.message || 'No se pudo enviar el mensaje. Probá de nuevo.' })
    }
  }

  return (
    <form className="support-contact-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="support-contact-row">
        <label>
          Nombre
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" required />
        </label>
        <label>
          Email de contacto
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={160} autoComplete="email" required />
        </label>
      </div>
      <label>
        Mensaje
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, SUPPORT_MESSAGE_MAX_LENGTH))}
          maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
          rows={4}
          placeholder="Contanos en qué te podemos ayudar"
          required
        />
        <small className="support-contact-counter">{message.length}/{SUPPORT_MESSAGE_MAX_LENGTH}</small>
      </label>
      <input
        className="support-contact-trap"
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
      />
      {status ? <p className={status.ok ? 'notice' : 'error'}>{status.text}</p> : null}
      <button type="submit" disabled={busy || !message.trim()}>
        {busy ? 'Enviando...' : 'Enviar'}
      </button>
    </form>
  )
}
