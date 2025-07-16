import React, { useEffect, useState } from 'react'
import './Navbar.css'
import { useLanguage } from '../../state/LanguageContext'
import { logos } from '../../constants/variables'

export default function Navbar() {
  const { t, language, setLanguage } = useLanguage()
  const navbarLogos = logos.navbar as Record<string, string>

  // Dynamically extract organization from subdomain
  const getOrganizationFromHost = () => {
    const hostParts = window.location.hostname.split('.')
    console.log('Host parts in navbar:', hostParts)
    return hostParts.length >= 4 ? hostParts[0] : 'default'
  }

  const organization = getOrganizationFromHost()
  console.log('Organization in navbar:', organization)
  const logoSrc = navbarLogos[organization] || navbarLogos.default

  return (
    <>
      <nav className="navbar navbar-expand-lg bg-dark sticky-top" data-bs-theme="dark">
        <div className="container-fluid">
          {/* Left: Logo */}
          <a className="navbar-brand" href="#">
            <img src={logoSrc} alt="Logo" height="35" />
          </a>

          {/* Center: Chatbot by SNAP */}
          <div className="mx-auto">
            <a href="https://www.snap.de/" target="_blank" rel="noopener noreferrer" className="snap-link">
              {t('navbar.chatbotBySnap')}
            </a>
          </div>

          {/* Right: Language switcher */}
          <div className="d-flex align-items-center">
            <button
              className={`btn btn-sm ${language === 'en' ? 'btn-light' : 'btn-outline-light'}`}
              onClick={() => setLanguage('en')}
              aria-label={t('navbar.switchToEnglish')}>
              EN
            </button>
            <button
              className={`btn btn-sm ms-1 ${language === 'de' ? 'btn-light' : 'btn-outline-light'}`}
              onClick={() => setLanguage('de')}
              aria-label={t('navbar.switchToGerman')}>
              DE
            </button>
          </div>
        </div>
      </nav>
    </>
  )
}
