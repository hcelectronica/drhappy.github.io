import AuthBackground from './AuthBackground'
import './AuthBackground.css'

interface SplashScreenProps {
  leaving: boolean
}

/**
 * Splash de bienvenida: escena médica animada + título Dr Happy.
 * Se muestra ~3 segundos y luego cede con transición al login.
 */
export default function SplashScreen({ leaving }: SplashScreenProps) {
  return (
    <div className={`splash-screen ${leaving ? 'splash-screen--leaving' : ''}`} aria-hidden={leaving}>
      <AuthBackground />
      <div className="splash-content">
        <span className="splash-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="presentation">
            <rect x="4" y="4" width="56" height="56" rx="16" fill="#1d4ed8" />
            <circle cx="32" cy="32" r="19" fill="#93c5fd" opacity="0.35" />
            <path d="M32 13v38" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M24 28h16" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M22 18c4 4 7 6 10 6" stroke="#dbeafe" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M42 18c-4 4-7 6-10 6" stroke="#dbeafe" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="32" cy="50" r="4" fill="#dbeafe" />
            <circle cx="15" cy="48" r="2" fill="#bfdbfe" />
            <circle cx="49" cy="16" r="2" fill="#bfdbfe" />
          </svg>
        </span>
        <h1 className="splash-title">
          Dr Happy <span className="splash-title-emoji">😊</span>
        </h1>
        <p className="splash-slogan">Basta de Papeleo, Hagamos medicina.</p>
        <p className="splash-subtitle">Herramientas para profesionales de la salud e instituciones</p>
        <div className="splash-loader" role="presentation">
          <span className="splash-loader-bar" />
        </div>
      </div>
    </div>
  )
}
