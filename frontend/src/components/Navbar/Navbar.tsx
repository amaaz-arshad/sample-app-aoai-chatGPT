import React, { useContext, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import SnapLogo from '../../assets/Snap.svg';
import { AppStateContext } from '../../state/AppProvider';
import { getUserInfo, UserInfo } from '../../api';
import { FILTER_FIELD } from '../../constants/variables';
import "./Navbar.css";

export default function Navbar() {
  const appStateContext = useContext(AppStateContext);
  const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled;
  const [userDetails, setUserDetails] = useState<UserInfo[]>([]);

  useEffect(() => {
    if (AUTH_ENABLED !== undefined) {
      getUserInfo().then(info => setUserDetails(info));
    }
  }, [AUTH_ENABLED]);

  const getCompanyName = () => {
    if (userDetails && userDetails[0]?.user_claims) {
      const companyClaim = userDetails[0].user_claims.find(claim => claim.typ === "streetAddress");
      return companyClaim ? companyClaim.val.trim().toLowerCase() : '';
    }
    return '';
  };

  const companyName = getCompanyName();

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
              className={({ isActive }) =>
                isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2'
              }
              to="/">
              CHATBOT
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2'
              }
              to="/upload-files">
              UPLOAD FILES
            </NavLink>
            {companyName !== 'user' && (
              <>
                <NavLink
                  className={({ isActive }) =>
                    isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2'
                  }
                  to="/history">
                  HISTORY
                </NavLink>
                <NavLink
                  className={({ isActive }) =>
                    isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2'
                  }
                  to="/system-message">
                  SYSTEM MESSAGE
                </NavLink>
              </>
            )}
            {/* Logout button */}
            <button
              className="nav-link fw-bold"
              onClick={() => (window.location.href = '/.auth/logout')}>
              LOGOUT
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
