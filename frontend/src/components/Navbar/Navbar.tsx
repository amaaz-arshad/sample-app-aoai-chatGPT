import React, { useContext, useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import SnapLogo from '../../assets/Snap.svg'
import './Navbar.css'
import { useAppUser } from '../../state/AppUserProvider'
import { FILTER_FIELD2 } from '../../constants/variables'

export default function Navbar() {
  const { userInfo, authEnabled } = useAppUser()
  const [companyName, setCompanyName] = useState<string>('')

  useEffect(() => {
    if (userInfo && userInfo.length > 0) {
      const companyClaim = userInfo[0].user_claims.find(claim => claim.typ === FILTER_FIELD2)
      console.log('streetaddress value in navbar:', companyClaim)
      setCompanyName(companyClaim ? companyClaim.val.trim().toLowerCase() : '')
    }
  }, [userInfo])

  return (
    <nav className="navbar navbar-expand-lg bg-body-tertiary bg-dark sticky-top" data-bs-theme="dark">
      <div className="container-fluid">
        <a className="navbar-brand" href="#">
          <img src={SnapLogo} alt="Logo" height="35" />
        </a>
        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarNavAltMarkup"
          aria-controls="navbarNavAltMarkup"
          aria-expanded="false"
          aria-label="Toggle navigation">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNavAltMarkup">
          <div className="navbar-nav ms-auto">
            <NavLink
              className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
              to="/">
              Chatbot
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
              to="/upload-files">
              Dateien hochladen
            </NavLink>
            {(!companyName || companyName != 'user') && (
              <>
                <NavLink
                  className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
                  to="/history">
                  Verlauf
                </NavLink>
                <NavLink
                  className={({ isActive }) => (isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2')}
                  to="/system-message">
                  Systemnachricht
                </NavLink>
              </>
            )}
            {/* Logout button */}
            <button className="nav-link fw-bold" onClick={() => (window.location.href = '/.auth/logout')}>
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
