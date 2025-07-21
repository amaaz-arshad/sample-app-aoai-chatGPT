/* NavbarSimple.tsx */
import React, { useEffect, useState } from 'react'
import './Navbar.css'
import { useLanguage } from '../../state/LanguageContext'
import { FILTER_FIELD, logos } from '../../constants/variables'
import { useAppUser } from '../../state/AppUserProvider'

export default function NavbarSimple() {
  const { t, language, setLanguage } = useLanguage()

  const organization = window.location.hostname.split('.')[0].toLowerCase()
  const navbarLogos = logos.navbar as Record<string, string>
  const logoSrc = navbarLogos[organization] || navbarLogos.default

  return (
    <nav className="navbar navbar-expand-lg bg-dark sticky-top" data-bs-theme="dark">
      <div className="container-fluid position-relative">
        {/* Left: Logo */}
        <a className="navbar-brand" href="#">
          <img src={logoSrc} alt="Logo" height="35" />
        </a>

        {/* Center (mobile): Chatbot by SNAP */}
        <div className="mx-auto navbar-title-mobile">
          <a href="https://www.snap.de/" target="_blank" rel="noopener noreferrer" className="snap-link">
            {t('navbar.chatbotBySnap')}
          </a>
        </div>

        {/* Right: Language switcher and Logout */}
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
          {/* Logout button */}
          <button
            className="btn btn-sm btn-outline-light ms-3"
            onClick={() => (window.location.href = '/.auth/logout')}
            aria-label={t('navbar.logout')}>
            {t('navbar.logout')}
          </button>
        </div>

        {/* Center (desktop): absolute Chatbot by SNAP */}
        <a
          href="https://www.snap.de/"
          target="_blank"
          rel="noopener noreferrer"
          className="snap-link navbar-title-desktop">
          {t('navbar.chatbotBySnap')}
        </a>
      </div>
    </nav>
  )
}
