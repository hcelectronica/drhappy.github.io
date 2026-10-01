import { useCallback, useEffect, useState } from 'react'
import {
  deleteSupportMessage,
  listSupportMessages,
  setSupportMessageStatus,
} from './supportService'
import type { SupportMessage } from './supportService'

export function AdminSupportInbox() {
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await listSupportMessages()
    setLoading(false)
    if (result.success) setMessages(result.messages ?? [])
    else setError(result.message || 'No se pudieron cargar los mensajes.')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleStatus(id: string, status: 'pending' | 'read'): Promise<void> {
    const result = await setSupportMessageStatus(id, status)
    if (!result.success) {
      setError(result.message || 'No se pudo actualizar el mensaje.')
      return
    }
    setMessages((current) => current.map((entry) => (entry.id === id ? { ...entry, status } : entry)))
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm('¿Eliminar este mensaje?')) return
    const result = await deleteSupportMessage(id)
    if (!result.success) {
      setError(result.message || 'No se pudo eliminar el mensaje.')
      return
    }
    setMessages((current) => current.filter((entry) => entry.id !== id))
  }

  const pendingCount = messages.filter((entry) => entry.status === 'pending').length
  const visible = filter === 'pending' ? messages.filter((entry) => entry.status === 'pending') : messages

  return (
    <section className="panel support-inbox" style={{ marginTop: 20 }}>
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>💬 Mensajes de soporte</h3>
          <p className="flow-hint">Mensajes enviados desde "Contactar desarrolladores". {pendingCount} pendiente{pendingCount === 1 ? '' : 's'}.</p>
        </div>
        <div className="support-inbox-actions">
          <button type="button" className={filter === 'pending' ? '' : 'ghost'} onClick={() => setFilter('pending')}>Pendientes</button>
          <button type="button" className={filter === 'all' ? '' : 'ghost'} onClick={() => setFilter('all')}>Todos</button>
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>Actualizar</button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="flow-hint">Cargando mensajes...</p> : null}
      {!loading && visible.length === 0 ? (
        <p className="flow-hint">{filter === 'pending' ? 'No hay mensajes pendientes.' : 'Todavía no llegaron mensajes.'}</p>
      ) : null}

      <ul className="support-inbox-list">
        {visible.map((entry) => (
          <li key={entry.id} className={entry.status === 'pending' ? 'is-pending' : ''}>
            <div className="support-inbox-head">
              <strong>{entry.name}</strong>
              <a href={`mailto:${encodeURIComponent(entry.email)}?subject=${encodeURIComponent('Respuesta de Dr Happy')}`}>{entry.email}</a>
              {entry.professional_id ? <span className="support-inbox-tag">Usuario registrado</span> : null}
              <time dateTime={entry.created_at}>
                {new Date(entry.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
            <p className="support-inbox-message">{entry.message}</p>
            <div className="support-inbox-actions">
              {entry.status === 'pending' ? (
                <button type="button" onClick={() => void handleStatus(entry.id, 'read')}>Marcar como leído</button>
              ) : (
                <button type="button" className="ghost" onClick={() => void handleStatus(entry.id, 'pending')}>Marcar como pendiente</button>
              )}
              <button type="button" className="ghost danger" onClick={() => void handleDelete(entry.id)}>Eliminar</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
