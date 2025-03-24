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

initializeIcons('https://res.cdn.office.net/files/fabric-cdn-prod_20240129.001/assets/icons/')

export default function App() {
  return (
    <AppStateProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Chat />} />
            <Route path="*" element={<NoPage />} />
          </Route>
          <Route path="/upload-files" element={<FileUpload />} />
          <Route path="/history" element={<History />} />
          <Route path="/system-message" element={<SystemMessage />} />
        </Routes>
      </HashRouter>
    </AppStateProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
    <ToastContainer position="top-right" autoClose={3000} theme="colored" />
  </React.StrictMode>
)
