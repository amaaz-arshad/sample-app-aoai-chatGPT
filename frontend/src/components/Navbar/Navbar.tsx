import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import './Navbar.css'
import { useAppUser } from '../../state/AppUserProvider'
import { FILTER_FIELD, FILTER_FIELD2, logos } from '../../constants/variables'
import { useLanguage } from '../../state/LanguageContext'

export default function Navbar() {
  const { userInfo } = useAppUser()
  const { t, language, setLanguage } = useLanguage()
  const [userType, setUserType] = useState<string>('')
  const [organization, setOrganization] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    if (userInfo && userInfo.length > 0) {
      const organizationClaim = userInfo[0].user_claims.find(claim => claim.typ === FILTER_FIELD)
      setOrganization(organizationClaim ? organizationClaim.val.trim().toLowerCase() : '')

      const userTypeClaim = userInfo[0].user_claims.find(claim => claim.typ === FILTER_FIELD2)
      setUserType(userTypeClaim ? userTypeClaim.val.trim().toLowerCase() : '')
    }
    setIsLoading(false)
  }, [userInfo])

  // choose logo from nested navbar object
  const navbarLogos = logos.navbar as Record<string, string>
  const logoSrc = navbarLogos[organization] || navbarLogos.default

  return (
    <nav className="navbar navbar-expand-lg bg-body-tertiary bg-dark sticky-top" data-bs-theme="dark">
      <div className="container-fluid" style={{ visibility: isLoading ? 'hidden' : 'visible' }}>
        <a className="navbar-brand" href="#">
          <img src={logoSrc} alt="Logo" height="35" />
        </a>

        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarNavAltMarkup"
          aria-controls="navbarNavAltMarkup"
          aria-expanded="false"
          aria-label={t('navbar.toggleMenu')}>
          <span className="navbar-toggler-icon"></span>
        </button>

        <div className="collapse navbar-collapse" id="navbarNavAltMarkup">
          <div className="navbar-nav ms-auto">
            <NavLink
              className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
              to="/">
              {t('navbar.chatbot')}
            </NavLink>

            {userType !== 'read-only' && (
              <NavLink
                className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
                to="/upload-files">
                {t('navbar.uploadFiles')}
              </NavLink>
            )}

            {(!userType || userType === 'admin') && (
              <>
                <NavLink
                  className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
                  to="/history">
                  {t('navbar.history')}
                </NavLink>
                <NavLink
                  className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
                  to="/system-message">
                  {t('navbar.systemMessage')}
                </NavLink>
              </>
            )}

            {/* Logout button */}
            <button className="nav-link fw-bold" onClick={() => (window.location.href = '/.auth/logout')}>
              {t('navbar.logout')}
            </button>
          </div>
        </div>

        {/* Language Switcher */}
        <div className="d-flex ms-3">
          <button
            className={`btn btn-sm ${language === 'en' ? 'btn-light' : 'btn-outline-light'}`}
            onClick={() => setLanguage('en')}
            aria-label={t('navbar.switchToEnglish')}>
            EN
          </button>
          <button
            className={`btn btn-sm ${language === 'de' ? 'btn-light' : 'btn-outline-light'} ms-1`}
            onClick={() => setLanguage('de')}
            aria-label={t('navbar.switchToGerman')}>
            DE
          </button>
        </div>
      </div>
    </nav>
  )
}
