import { renderToStaticMarkup } from 'react-dom/server'
import { DentalTooth } from './DentalTooth'
import { CONDITIONS, PERMANENT_ROWS, TEMPORARY_ROWS, dentalAccount, markColor, surfaceLabel } from './dentalModel'
import type { DentalDesignRecord } from './dentalModel'
import { dentalDate, dentalMoney, dentalStatusLabels, dentalLedgerRows } from './dentalPresentation'
import dentalStyles from './dentalDesign.css?inline'

const printStyles = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; font-family: Arial, sans-serif; color: #183b43; }
.dental-print { width: 100%; padding: 0; font-size: 10px; }
.dental-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.print-face { border-top: 3px solid #177463; padding: 6px 0; }
.print-face--front { min-height: 138mm; }
.print-face--back .print-heading p { display: inline; margin-right: 8px; }
.print-face--back .print-heading h1 { font-size: 14px; }
.dental-print .print-face--back small { display: inline; }
.print-face--back small::before { content: " · "; }
.print-heading { display: flex; justify-content: space-between; align-items: start; gap: 12px; border-bottom: 1px solid #d2e1e1; padding-bottom: 5px; }
.print-heading > div:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.print-heading > div:last-child { flex: 0 0 28%; text-align: right; overflow-wrap: anywhere; }
.print-face--back .print-heading > div:last-child p { display: block; margin-right: 0; }
.print-heading h1 { margin: 2px 0; font-size: 16px; }
.print-heading p { margin: 2px 0; }
.print-kicker { display: block; color: #177463; font-size: 9px; font-weight: bold; letter-spacing: .7px; }
.print-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px 10px; padding: 6px 0; }
.print-meta div { min-width: 0; border-bottom: 1px solid #d2e1e1; padding-bottom: 3px; overflow-wrap: anywhere; }
.print-meta span { color: #536a71; margin-right: 4px; font-size: 9px; }
.print-front-columns { display: grid; grid-template-columns: 1.05fr 1fr; gap: 10px; align-items: start; }
.print-front-columns > div { min-width: 0; }
.print-chart { border: 1px solid #d2e1e1; border-radius: 8px; padding: 6px; }
.dental-print .dental-chart-canvas { width: 100%; min-width: 0; }
.dental-print .dental-tooth-number { padding: 0; font-size: 9px; }
.dental-print .dental-tooth-count { display: none; }
.dental-print .dental-tooth svg { height: 19px; }
.dental-print .dental-dentition { margin-bottom: 6px; }
.dental-print .dental-dentition--temporary { margin: 6px auto; }
.dental-print .dental-quadrant-labels { padding-top: 2px; font-size: 8px; }
.dental-print .dental-dentition h3 { margin: 0 0 4px; font-size: 10px; }
.dental-print h3 { color: #177463; font-size: 10px; margin: 5px 0 3px; }
.dental-print p { line-height: 1.3; margin: 4px 0; }
.print-notes { white-space: pre-wrap; overflow-wrap: anywhere; padding: 4px 6px; border: 1px solid #d2e1e1; border-radius: 5px; }
.print-legend { display: flex; flex-wrap: wrap; gap: 3px 10px; margin: 5px 0; font-size: 9px; }
.print-red { color: #b42336; }
.print-blue { color: #2457ba; }
.dental-print table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
.dental-print th { text-align: left; background: #ecf4f0; color: #285a4d; }
.dental-print td, .dental-print th { padding: 3px 4px; border-bottom: 1px solid #d2e1e1; overflow-wrap: anywhere; vertical-align: top; line-height: 1.2; }
.dental-print small { display: block; color: #536a71; margin-top: 1px; font-size: 8px; }
.dental-print tr, .print-chart, .print-heading, .print-totals, .print-signatures { break-inside: avoid; }
.dental-print thead { display: table-header-group; }
.dental-print h3 { break-after: avoid; }
.print-totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 6px 0; }
.print-totals div { background: #eaf5ef; border: 1px solid #aad0c4; border-radius: 6px; padding: 5px 7px; }
.print-totals span { display: block; font-size: 9px; margin-bottom: 3px; }
.print-totals strong { font-size: 11px; }
.print-signatures { display: flex; gap: 30px; margin-top: 18px; }
.print-signatures span { flex: 1; padding-top: 4px; border-top: 1px dashed #a1b7b4; text-align: center; font-size: 9px; }
.print-actions { padding: 16px; background: #eaf5ef; font-size: 14px; }
.print-actions button { margin-right: 12px; padding: 10px; cursor: pointer; }
@media screen { .dental-print { width: 194mm; margin: 20px auto; } }
@media print { .print-actions { display: none; } }
`

export function buildDentalPrintHtml(record: DentalDesignRecord, professional?: { fullName: string; licenseNumber: string }, demo = false) {
  const account = dentalAccount(record)
  const ledger = dentalLedgerRows(record)
  const emitted = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
  const heading = (face: string, title: string) => <header className="print-heading">
    <div><span className="print-kicker">DR HAPPY · ODONTOLOGÍA · {face}</span><h1>{title}</h1>
      <p><strong>{record.patient.name || 'Paciente sin nombre'}</strong> · DNI {record.patient.dni || 'Sin registrar'}</p>
      {professional ? <p>{professional.fullName} · Matrícula {professional.licenseNumber || 'Sin registrar'}</p> : null}
    </div><div><p>{demo ? 'DEMOSTRACIÓN · DATOS FICTICIOS' : record.status === 'confirmed' ? 'Ficha confirmada' : 'Ficha provisoria'}</p><p>Emisión: {emitted}</p></div>
  </header>
  const content = renderToStaticMarkup(<main className="dental-preview dental-print">
    <section className="print-face print-face--front">
      {heading('ANVERSO', 'Odontograma')}
      <div className="print-meta">{([
        ['birthDate', 'Fecha de nacimiento'],
        ['address', 'Domicilio'], ['locality', 'Localidad'], ['phone', 'Teléfono'],
        ['coverage', 'Obra social'], ['memberNumber', 'Número de afiliado'], ['email', 'Email'],
      ] as const).map(([key, label]) => <div key={key}><span>{label}</span><strong>{key === 'birthDate' && record.patient[key] ? dentalDate(record.patient[key]) : record.patient[key] || '—'}</strong></div>)}</div>
      <div className="print-front-columns"><div>
      <div className="print-chart"><div className="dental-chart-canvas">
        {[{ name: 'Dentición permanente', rows: PERMANENT_ROWS }, { name: 'Dentición temporal', rows: TEMPORARY_ROWS }].map((group) =>
          <div className={`dental-dentition ${group.rows === TEMPORARY_ROWS ? 'dental-dentition--temporary' : ''}`} key={group.name}>
            <h3>{group.name}</h3>{group.rows.map((row, index) => <div className="dental-tooth-row" key={index}>{row.map((tooth) =>
              <DentalTooth key={tooth} tooth={tooth} marks={record.marks.filter((mark) => mark.tooth === tooth)} selected={false} surface="whole" onSelect={() => {}} />)}</div>)}
            <div className="dental-quadrant-labels"><span>Derecha del paciente</span><span>Izquierda del paciente</span></div>
          </div>)}
      </div></div>
      <div className="print-legend"><strong className="print-red">Rojo · prestaciones necesarias</strong><strong className="print-blue">Azul · prestaciones existentes</strong>
        <span>× Ausente / no erupcionada · = Extracción · ⊓ Prótesis fija · □ Removible · ○ Corona</span></div>
      <p>Una pieza sin marcas está sin registrar: no equivale a una pieza sana.</p>
      </div><div>
      <h3>Observaciones de la atención</h3><div className="print-notes">{record.observations || 'Sin observaciones registradas.'}</div>
      <h3>Obra social / afiliación</h3><div className="print-notes">{record.coverageNotes || 'Sin notas adicionales.'}</div>
      <h3>Registros por pieza</h3>
      {record.marks.length ? <table><thead><tr><th>Pieza / cara</th><th>Hallazgo / prestación</th><th>Referencia y observación</th></tr></thead><tbody>
        {record.marks.map((mark) => <tr key={mark.id}><td>{mark.tooth} · {surfaceLabel(mark.surface, mark.tooth)}</td><td>{CONDITIONS.find((item) => item.id === mark.condition)?.label}<small>{new Date(mark.createdAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</small></td>
          <td><strong className={`print-${markColor(mark)}`}>{markColor(mark) === 'red' ? 'Necesaria · rojo' : 'Existente · azul'}</strong>{mark.note ? <small>{mark.note}</small> : null}</td></tr>)}
      </tbody></table> : <p>Sin marcas registradas.</p>}
      <h3>Consentimiento informado</h3><div className="print-notes">{record.consentNotes || 'Sin referencia registrada.'}</div>
      <p>Esta referencia no reemplaza la firma del paciente.</p>
      </div></div>
      <div className="print-signatures"><span>Firma y sello del profesional</span><span>Firma y aclaración del paciente</span></div>
    </section>
    <section className="print-face print-face--back">
      {heading('REVERSO', 'Tratamientos y pagos')}
      <h3>Trabajo a realizar · presupuesto y costo interno</h3>
      <table><thead><tr><th>Fecha</th><th style={{ width: '30%' }}>Trabajo / pieza / cara</th><th>Presupuesto</th><th>Costo interno</th><th>Estado</th></tr></thead><tbody>
        {record.treatments.map((item) => <tr key={item.id}><td>{dentalDate(item.date)}</td><td><strong>{item.work}</strong><small>Pieza {item.tooth} · {surfaceLabel(item.surface, item.tooth)}</small></td><td>{dentalMoney(item.budgetCents)}</td><td>{dentalMoney(item.internalCostCents)}</td><td>{dentalStatusLabels[item.status]}{item.acceptedDate ? <small>Aceptado: {dentalDate(item.acceptedDate)}</small> : null}{item.performedDate ? <small>Realizado: {dentalDate(item.performedDate)}</small> : null}</td></tr>)}
        {!record.treatments.length ? <tr><td colSpan={5}>Sin trabajos registrados.</td></tr> : null}
      </tbody></table>
      <p>Los presupuestos propuestos no generan deuda. El costo interno no se cobra al paciente.</p>
      <div className="print-totals">{[
        ['Presupuestos aceptados', account.charged], ['Pagos registrados', account.paid],
        ['Saldo del paciente', account.balance], ['Costos internos aceptados', account.internalCost],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{dentalMoney(Number(value))}</strong></div>)}</div>
      <h3>Cuenta · cargos y pagos</h3>
      <table><thead><tr><th>Fecha</th><th style={{ width: '34%' }}>Movimiento / pieza / cara</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead><tbody>
        {ledger.map((row) => <tr key={row.id}><td>{dentalDate(row.date)}</td><td><strong>{row.label}</strong><small>Pieza {row.tooth} · {row.face} · {row.detail}</small></td><td>{row.debit ? dentalMoney(row.debit) : '—'}</td><td>{row.credit ? dentalMoney(row.credit) : '—'}</td><td>{dentalMoney(row.balance)}</td></tr>)}
        {!ledger.length ? <tr><td colSpan={5}>Sin movimientos registrados.</td></tr> : null}
      </tbody></table>
      <p>Costos separados de la cuenta del paciente. Mercado Pago es un medio registrado manualmente, no un comprobante del proveedor.</p>
    </section>
  </main>)
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ficha odontológica</title><style>${dentalStyles}\n${printStyles}</style></head><body><div class="print-actions"><button type="button" id="dental-print-now">Imprimir / Guardar como PDF</button>Ficha en color · ambas caras. Elegí Guardar como PDF o una impresora en color. Desactivá encabezados y pies del navegador.</div>${content}</body></html>`
}

export function printDentalRecord(record: DentalDesignRecord, professional?: { fullName: string; licenseNumber: string }, demo = false) {
  const html = buildDentalPrintHtml(record, professional, demo)
  const printWindow = window.open('', '_blank', 'width=900,height=800')
  if (!printWindow) throw new Error('No se pudo abrir la ficha para imprimir. Permití las ventanas emergentes y volvé a intentarlo.')
  printWindow.opener = null
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.document.getElementById('dental-print-now')?.addEventListener('click', () => printWindow.print())
  printWindow.focus()
  printWindow.print()
}
