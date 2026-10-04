import AuthBackground from './AuthBackground'
import { BrandMark } from './BrandMark'
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
          <BrandMark />
        </span>
        <h1 className="splash-title">
          Dr Happy
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
