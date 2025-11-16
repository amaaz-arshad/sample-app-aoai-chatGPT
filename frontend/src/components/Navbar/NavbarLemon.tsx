import React from 'react'
import './NavbarLemon.css'
import { useLanguage } from '../../state/LanguageContext'
import { LEMON_HEADING, logos } from '../../constants/variables'

// Fluent UI icons
import {
  MoreHorizontal24Regular,
  ChatAdd24Regular,
  ChatDismiss24Regular,
  History24Regular,
  Globe24Regular
} from '@fluentui/react-icons'

type Props = {
  chatbotName?: string
  onStartNewChat?: () => void
  onEndChat?: () => void
  onViewRecentChats?: () => void
}

export default function NavbarLemon({ chatbotName, onStartNewChat, onEndChat, onViewRecentChats }: Props) {
  const { t, language, setLanguage } = useLanguage()
  const navbarLogos = logos.navbar as Record<string, string>

  const getOrganizationFromHost = () => {
    const hostParts = window.location.hostname.split('.')
    return hostParts.length >= 4 ? hostParts[0] : 'default'
  }

  const organization = getOrganizationFromHost()
  const logoSrc = navbarLogos[organization] || navbarLogos.default
  const title = LEMON_HEADING

  return (
    <nav className="navbar navbar-snap sticky-top">
      <div className="container-fluid position-relative d-flex align-items-center">
        {/* Left: circular logo */}
        <a className="navbar-brand d-flex align-items-center" href="#" aria-label="Home">
          <div className="logo-circle">
            <img src={logoSrc} alt="Logo" />
          </div>
        </a>

        {/* Center: dynamic chatbot name */}
        <div className="navbar-title position-absolute top-50 start-50 translate-middle text-truncate">{title}</div>

        {/* Right: menu (horizontal dots) */}
        <div className="dropdown ms-auto">
          <button
            className="btn btn-link text-black p-0 menu-btn"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            aria-label="Open menu">
            <MoreHorizontal24Regular />
          </button>

          <ul className="dropdown-menu dropdown-menu-end dropdown-light">
            <li>
              <button className="dropdown-item d-flex align-items-center gap-2" onClick={onStartNewChat}>
                <ChatAdd24Regular />
                <span>Start a new chat</span>
              </button>
            </li>
            <li>
              <button className="dropdown-item d-flex align-items-center gap-2" onClick={onEndChat}>
                <ChatDismiss24Regular />
                <span>End chat</span>
              </button>
            </li>
            <li>
              <button className="dropdown-item d-flex align-items-center gap-2" onClick={onViewRecentChats}>
                <History24Regular />
                <span>View recent chats</span>
              </button>
            </li>

            {/* <li>
              <hr className="dropdown-divider" />
            </li>

            <li className="px-3 py-1 text-muted small d-flex align-items-center gap-2">
              <span>Language</span>
            </li>
            <li className="px-3 pb-2 d-flex align-items-center">
              <button
                className={`btn btn-sm ${language === 'en' ? 'btn-dark' : 'btn-outline-dark'}`}
                onClick={() => setLanguage('en')}>
                EN
              </button>
              <span className="px-2">|</span>
              <button
                className={`btn btn-sm ${language === 'de' ? 'btn-dark' : 'btn-outline-dark'}`}
                onClick={() => setLanguage('de')}>
                DE
              </button>
            </li> */}
          </ul>
        </div>
      </div>
    </nav>
  )
}
