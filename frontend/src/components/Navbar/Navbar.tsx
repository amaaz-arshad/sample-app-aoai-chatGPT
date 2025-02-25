import React from 'react';
import { NavLink } from 'react-router-dom';
import SnapLogo from '../../assets/Snap.svg';
import "./Navbar.css"

export default function Navbar() {
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
              to="/"
            >
              CHATBOT
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2'
              }
              to="/upload-files"
            >
              UPLOAD FILES
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                isActive ? 'nav-link active fw-bold me-2' : 'nav-link fw-bold me-2'
              }
              to="/history"
            >
              HISTORY
            </NavLink>
            {/* Logout button */}
            <button
              className="nav-link fw-bold"
              onClick={() => (window.location.href = '/.auth/logout')}
            >
              LOGOUT
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
