import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import './Navbar.css'
import { useAppUser } from '../../state/AppUserProvider'
import { FILTER_FIELD, FILTER_FIELD2, logos } from '../../constants/variables'
import { useLanguage } from '../../state/LanguageContext'
import { useBackgroundJobs } from '../../state/BackgroundJobsContext'
import { Dropdown, Spinner } from 'react-bootstrap'
import { toast, ToastContainer } from 'react-toastify'

const hostname = window.location.hostname.split('.')
const isOrgDomain = hostname[1] == 'chatbot'

export default function Navbar() {
  const { userInfo } = useAppUser()
  const { t, language, setLanguage } = useLanguage()
  const [userType, setUserType] = useState<string>('')
  const [organization, setOrganization] = useState<string>(isOrgDomain ? hostname[0].toLowerCase() : '')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const { jobs } = useBackgroundJobs()

  // Calculate active jobs
  const activeJobs = jobs.filter(job => job.status === 'queued' || job.status === 'processing')
  const notificationCount = activeJobs.length

  useEffect(() => {
    if (userInfo && userInfo.length > 0) {
      if (!isOrgDomain) {
        const organizationClaim = userInfo[0].user_claims.find(claim => claim.typ === FILTER_FIELD)
        setOrganization(organizationClaim ? organizationClaim.val.trim().toLowerCase() : '')
      }
      const userTypeClaim = userInfo[0].user_claims.find(claim => claim.typ === FILTER_FIELD2)
      setUserType(userTypeClaim ? userTypeClaim.val.trim().toLowerCase() : '')
    }
    setIsLoading(false)
  }, [userInfo])

  // Show completion notifications
  useEffect(() => {
    const completedJobs = jobs.filter(job => job.status === 'completed')
    completedJobs.forEach(job => {
      if (!toast.isActive(job.job_id)) {
        toast.success(t('fileUpload.processingComplete'), {
          toastId: job.job_id,
          autoClose: 3000
        })
      }
    })
  }, [jobs, t])

  // choose logo from nested navbar object
  const navbarLogos = logos.navbar as Record<string, string>
  const logoSrc = navbarLogos[organization] || navbarLogos.default

  return (
    <>
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

          {/* Language Switcher and Notification */}
          <div className="d-flex align-items-center ms-2">
            <div className="d-flex">
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

            {/* Job Notification Dropdown - Only shows when there are active jobs */}
            {notificationCount > 0 && (
              <Dropdown className="ms-3 me-2">
                <Dropdown.Toggle
                  variant="dark"
                  id="notification-dropdown"
                  className="position-relative bg-transparent border-0 p-0"
                  style={{ cursor: 'pointer' }}>
                  <i className="bi bi-bell fs-4 text-light"></i>
                  <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">
                    {notificationCount}
                  </span>
                </Dropdown.Toggle>

                <Dropdown.Menu align="end" className="mt-2" style={{ minWidth: '250px' }}>
                  <Dropdown.ItemText style={{ fontSize: '0.9rem' }}>
                    <Spinner animation="border" size="sm" className="me-2" />
                    {t('fileUpload.filesProcessing')}
                  </Dropdown.ItemText>
                </Dropdown.Menu>
              </Dropdown>
            )}
          </div>

          {/* Center (desktop): absolute Chatbot by SNAP */}
          {isOrgDomain && (
            <a
              href="https://www.snap.de/"
              target="_blank"
              rel="noopener noreferrer"
              className="snap-link navbar-title-desktop">
              {t('navbar.chatbotBySnap')}
            </a>
          )}
        </div>
      </nav>

      {/* Global Toast Container */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="colored"
      />
    </>
  )
}
