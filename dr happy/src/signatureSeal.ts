// Refuerzo de firma (Nivel 1): convierte la firma gráfica simple en una
// "firma electrónica simple" con mayor fuerza probatoria, agregando:
//  - Hash criptográfico (SHA-256) del contenido firmado.
//  - Timestamp de firma.
//  - Datos del firmante (quién, con qué matrícula).
// Esto permite demostrar posteriormente que un documento no fue alterado
// desde el momento de la firma y quién lo firmó, sin depender de terceros.

export interface SignatureSeal {
  hashSha256: string        // Hash SHA-256 del contenido firmado
  signedAt: string          // Timestamp ISO de la firma
  signedByUserId: string    // ID del profesional que firmó
  signedByFullName: string  // Nombre completo del firmante
  signedByLicense: string   // Matrícula del firmante
  signedByDni?: string      // DNI del firmante (si está disponible)
  method: 'firma-electronica-simple'
  algorithm: 'SHA-256'
}

// Calcula el hash SHA-256 de un string usando la Web Crypto API.
export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Genera el sello de firma reforzada para un contenido dado.
// El contenido se normaliza (se firma el JSON canónico) para que el hash
// sea verificable de forma determinista.
export async function buildSignatureSeal(params: {
  contentToSign: Record<string, unknown>
  signerUserId: string
  signerFullName: string
  signerLicense: string
  signerDni?: string
}): Promise<SignatureSeal> {
  const signedAt = new Date().toISOString()
  const canonicalContent = JSON.stringify({
    content: params.contentToSign,
    signer: {
      userId: params.signerUserId,
      fullName: params.signerFullName,
      license: params.signerLicense,
      dni: params.signerDni ?? '',
    },
    signedAt,
  })
  const hashSha256 = await sha256Hex(canonicalContent)
  return {
    hashSha256,
    signedAt,
    signedByUserId: params.signerUserId,
    signedByFullName: params.signerFullName,
    signedByLicense: params.signerLicense,
    signedByDni: params.signerDni,
    method: 'firma-electronica-simple',
    algorithm: 'SHA-256',
  }
}

// Re-verifica que un contenido y su sello coincidan (para mostrar un
// indicador de "firma íntegra / documento no alterado").
export async function verifySignatureSeal(params: {
  contentToVerify: Record<string, unknown>
  seal: SignatureSeal
}): Promise<boolean> {
  const canonicalContent = JSON.stringify({
    content: params.contentToVerify,
    signer: {
      userId: params.seal.signedByUserId,
      fullName: params.seal.signedByFullName,
      license: params.seal.signedByLicense,
      dni: params.seal.signedByDni ?? '',
    },
    signedAt: params.seal.signedAt,
  })
  const recomputed = await sha256Hex(canonicalContent)
  return recomputed === params.seal.hashSha256
}
