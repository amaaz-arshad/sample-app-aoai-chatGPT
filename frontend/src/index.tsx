import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { initializeIcons } from '@fluentui/react'

import Chat from './pages/chat/Chat'
import Layout from './pages/layout/Layout'
import FileUpload from './pages/fileUpload/FileUpload'
import NoPage from './pages/NoPage'
import { AppStateProvider } from './state/AppProvider'

import './index.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.min.js'
import 'react-toastify/dist/ReactToastify.css'
import { ToastContainer } from 'react-toastify'
import History from './pages/history/History'
import SystemMessage from './pages/systemMessage/SystemMessage'
import { AppUserProvider } from './state/AppUserProvider'
import { LanguageProvider } from './state/LanguageContext'
import { BackgroundJobsProvider } from './state/BackgroundJobsContext'
import ChatLemon from './pages/chat/ChatLemon'
import LayoutLemon from './pages/layout/LayoutLemon'

initializeIcons('https://res.cdn.office.net/files/fabric-cdn-prod_20240129.001/assets/icons/')

export default function App() {
  const getOrganizationFromHost = () => {
    const hostParts = window.location.hostname.split('.')
    console.log('Host parts in navbar:', hostParts)
    return hostParts.length >= 4 ? hostParts[0] : 'default'
  }

  const organization = getOrganizationFromHost()
  const isLemon = organization === 'lemon' || organization === 'lemon2'

  // choose layout + chat once
  const RootLayout = isLemon ? LayoutLemon : Layout
  const ChatPage = isLemon ? ChatLemon : Chat

  return (
    <AppStateProvider>
      <LanguageProvider>
        <AppUserProvider>
          <BackgroundJobsProvider>
            <HashRouter>
              <Routes>
                <Route path="/" element={<RootLayout />}>
                  <Route index element={<ChatPage />} />
                  <Route path="*" element={<NoPage />} />
                </Route>
                <Route path="/system-message" element={<SystemMessage />} />
                {/* {organization !== 'publishone' && (
                  <>
                    <Route path="/upload-files" element={<FileUpload />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/system-message" element={<SystemMessage />} />
                  </>
                )} */}
              </Routes>
            </HashRouter>
          </BackgroundJobsProvider>
        </AppUserProvider>
      </LanguageProvider>
    </AppStateProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
    <ToastContainer position="top-right" autoClose={3000} theme="colored" />
  </React.StrictMode>
)
