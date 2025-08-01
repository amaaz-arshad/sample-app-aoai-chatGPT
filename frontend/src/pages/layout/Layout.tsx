/* layout.tsx */
import { useContext, useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Dialog, Stack, TextField } from '@fluentui/react'
import { CopyRegular } from '@fluentui/react-icons'

import { CosmosDBStatus } from '../../api'
import Snap from '../../assets/Snap.svg'
import { HistoryButton, ShareButton } from '../../components/common/Button'
import { AppStateContext } from '../../state/AppProvider'

import styles from './Layout.module.css'
import Navbar from '../../components/Navbar/Navbar'
import { useLanguage } from '../../state/LanguageContext'

const Layout = () => {
  const [isSharePanelOpen, setIsSharePanelOpen] = useState<boolean>(false)
  const [copyClicked, setCopyClicked] = useState<boolean>(false)
  const { t } = useLanguage()
  const [shareLabel, setShareLabel] = useState<string | undefined>(t('layout.logout'))
  const [hideHistoryLabel, setHideHistoryLabel] = useState<string>(t('layout.hideChatHistory'))
  const [showHistoryLabel, setShowHistoryLabel] = useState<string>(t('layout.showChatHistory'))
  const [logo, setLogo] = useState('')
  const appStateContext = useContext(AppStateContext)
  const ui = appStateContext?.state.frontendSettings?.ui

  const handleSharePanelDismiss = () => {
    setIsSharePanelOpen(false)
    setCopyClicked(false)
  }

  const handleCopyClick = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopyClicked(true)
  }

  const handleHistoryClick = () => {
    appStateContext?.dispatch({ type: 'TOGGLE_CHAT_HISTORY' })
  }

  useEffect(() => {
    if (!appStateContext?.state.isLoading) {
      setLogo(ui?.logo || Snap)
    }
  }, [appStateContext?.state.isLoading])

  useEffect(() => {}, [appStateContext?.state.isCosmosDBAvailable.status])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 480) {
        setShareLabel(undefined)
        setHideHistoryLabel(t('layout.hideHistoryShort'))
        setShowHistoryLabel(t('layout.showHistoryShort'))
      } else {
        setShareLabel(t('layout.logout'))
        setHideHistoryLabel(t('layout.hideChatHistory'))
        setShowHistoryLabel(t('layout.showChatHistory'))
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize()

    return () => window.removeEventListener('resize', handleResize)
  }, [t])

  return (
    <>
      <div className={styles.layout}>
        {/* Conditionally render Navbar variants */}
        <Navbar />

        <header className={styles.header} role={'banner'}>
          <Stack horizontal verticalAlign="center" horizontalAlign="space-between">
            <Stack horizontal verticalAlign="center">
              {/* logo and title omitted for brevity */}
            </Stack>
            <Stack horizontal tokens={{ childrenGap: 4 }} className={styles.shareButtonContainer}>
              {appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured &&
                ui?.show_chat_history_button !== false && (
                  <HistoryButton
                    onClick={handleHistoryClick}
                    text={appStateContext?.state?.isChatHistoryOpen ? hideHistoryLabel : showHistoryLabel}
                  />
                )}
              {/* share button removed or unchanged as desired */}
            </Stack>
          </Stack>
        </header>

        <Outlet />

        <Dialog
          onDismiss={handleSharePanelDismiss}
          hidden={!isSharePanelOpen}
          styles={{
            main: [
              {
                selectors: {
                  ['@media (min-width: 480px)']: {
                    maxWidth: '600px',
                    background: '#FFFFFF',
                    boxShadow: '0px 14px 28.8px rgba(0, 0, 0, 0.24), 0px 0px 8px rgba(0, 0, 0, 0.2)',
                    borderRadius: '8px',
                    maxHeight: '200px',
                    minHeight: '100px'
                  }
                }
              }
            ]
          }}
          dialogContentProps={{
            title: t('layout.shareDialogTitle'),
            showCloseButton: true
          }}>
          <Stack horizontal verticalAlign="center" style={{ gap: '8px' }}>
            <TextField className={styles.urlTextBox} defaultValue={window.location.href} readOnly />
            <div
              className={styles.copyButtonContainer}
              role="button"
              tabIndex={0}
              aria-label={t('layout.copy')}
              onClick={handleCopyClick}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? handleCopyClick() : null)}>
              <CopyRegular className={styles.copyButton} />
              <span className={styles.copyButtonText}>{copyClicked ? t('layout.copied') : t('layout.copy')}</span>
            </div>
          </Stack>
        </Dialog>
      </div>
    </>
  )
}

export default Layout
