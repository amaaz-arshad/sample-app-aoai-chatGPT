import { useContext } from 'react'
import React from 'react'
import {
  CommandBarButton,
  ContextualMenu,
  DefaultButton,
  Dialog,
  DialogFooter,
  DialogType,
  ICommandBarStyles,
  IContextualMenuItem,
  IStackStyles,
  PrimaryButton,
  Spinner,
  SpinnerSize,
  Stack,
  StackItem,
  Text
} from '@fluentui/react'
import { useBoolean } from '@fluentui/react-hooks'

import { ChatHistoryLoadingState, historyDeleteAll } from '../../api'
import { AppStateContext } from '../../state/AppProvider'
import { useLanguage } from '../../state/LanguageContext'

import ChatHistoryList from './ChatHistoryList'

import styles from './ChatHistoryPanel.module.css'

interface ChatHistoryPanelProps {}

export enum ChatHistoryPanelTabs {
  History = 'History'
}

const commandBarStyle: ICommandBarStyles = {
  root: {
    padding: '0',
    display: 'flex',
    justifyContent: 'center',
    backgroundColor: 'transparent'
  }
}

const commandBarButtonStyle: Partial<IStackStyles> = { root: { height: '50px' } }

export function ChatHistoryPanel(_props: ChatHistoryPanelProps) {
  const appStateContext = useContext(AppStateContext)
  const { t } = useLanguage()
  const [showContextualMenu, setShowContextualMenu] = React.useState(false)
  const [hideClearAllDialog, { toggle: toggleClearAllDialog }] = useBoolean(true)
  const [clearing, setClearing] = React.useState(false)
  const [clearingError, setClearingError] = React.useState(false)

  const clearAllDialogContentProps = {
    type: DialogType.close,
    title: !clearingError ? t('chatHistory.clearAllDialog.title') : t('chatHistory.clearAllDialog.errorTitle'),
    closeButtonAriaLabel: t('close'),
    subText: !clearingError ? t('chatHistory.clearAllDialog.subText') : t('chatHistory.clearAllDialog.errorSubText')
  }

  const modalProps = {
    titleAriaId: 'labelId',
    subtitleAriaId: 'subTextId',
    isBlocking: true,
    styles: { main: { maxWidth: 450 } }
  }

  const menuItems: IContextualMenuItem[] = [
    {
      key: 'clearAll',
      text: t('chatHistory.clearAll'),
      iconProps: { iconName: 'delete' }
    }
  ]

  const handleHistoryClick = () => {
    appStateContext?.dispatch({ type: 'TOGGLE_CHAT_HISTORY' })
  }

  const onShowContextualMenu = React.useCallback((ev: React.MouseEvent<HTMLElement>) => {
    ev.preventDefault() // don't navigate
    setShowContextualMenu(true)
  }, [])

  const onHideContextualMenu = React.useCallback(() => setShowContextualMenu(false), [])

  const onClearAllChatHistory = async () => {
    setClearing(true)
    const response = await historyDeleteAll()
    if (!response.ok) {
      setClearingError(true)
    } else {
      appStateContext?.dispatch({ type: 'DELETE_CHAT_HISTORY' })
      toggleClearAllDialog()
    }
    setClearing(false)
  }

  const onHideClearAllDialog = () => {
    toggleClearAllDialog()
    setTimeout(() => {
      setClearingError(false)
    }, 2000)
  }

  React.useEffect(() => {}, [appStateContext?.state.chatHistory, clearingError])

  return (
    <section className={styles.container} data-is-scrollable aria-label={t('chatHistory.panelAriaLabel')}>
      <Stack
        horizontal
        horizontalAlign="space-between"
        verticalAlign="center"
        wrap
        aria-label={t('chatHistory.headerAriaLabel')}>
        <StackItem>
          <Text
            role="heading"
            aria-level={2}
            style={{
              alignSelf: 'center',
              fontWeight: '600',
              fontSize: '18px',
              marginRight: 'auto',
              paddingLeft: '20px'
            }}>
            {t('chatHistory.title')}
          </Text>
        </StackItem>
        <Stack verticalAlign="start">
          <Stack horizontal styles={commandBarButtonStyle}>
            <CommandBarButton
              iconProps={{ iconName: 'More' }}
              title={t('chatHistory.clearAll')}
              onClick={onShowContextualMenu}
              aria-label={t('chatHistory.clearAll')}
              styles={commandBarStyle}
              role="button"
              id="moreButton"
            />
            <ContextualMenu
              items={menuItems}
              hidden={!showContextualMenu}
              target={'#moreButton'}
              onItemClick={toggleClearAllDialog}
              onDismiss={onHideContextualMenu}
            />
            <CommandBarButton
              iconProps={{ iconName: 'cancel' }}
              title={t('hide')}
              onClick={handleHistoryClick}
              aria-label={t('hide')}
              styles={commandBarStyle}
              role="button"
            />
          </Stack>
        </Stack>
      </Stack>
      <Stack
        aria-label={t('chatHistory.contentAriaLabel')}
        styles={{
          root: {
            display: 'flex',
            flexGrow: 1,
            flexDirection: 'column',
            paddingTop: '2.5px',
            maxWidth: '100%'
          }
        }}
        style={{
          display: 'flex',
          flexGrow: 1,
          flexDirection: 'column',
          flexWrap: 'wrap',
          padding: '1px'
        }}>
        <Stack className={styles.chatHistoryListContainer}>
          {appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Success &&
            appStateContext?.state.isCosmosDBAvailable.cosmosDB && <ChatHistoryList />}
          {appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Fail &&
            appStateContext?.state.isCosmosDBAvailable && (
              <>
                <Stack>
                  <Stack horizontalAlign="center" verticalAlign="center" style={{ width: '100%', marginTop: 10 }}>
                    <StackItem>
                      <Text style={{ alignSelf: 'center', fontWeight: '400', fontSize: 16 }}>
                        {appStateContext?.state.isCosmosDBAvailable?.status && (
                          <span>{appStateContext?.state.isCosmosDBAvailable?.status}</span>
                        )}
                        {!appStateContext?.state.isCosmosDBAvailable?.status && (
                          <span>{t('chatHistory.loadingError')}</span>
                        )}
                      </Text>
                    </StackItem>
                    <StackItem>
                      <Text style={{ alignSelf: 'center', fontWeight: '400', fontSize: 14 }}>
                        <span>{t('chatHistory.savingDisabled')}</span>
                      </Text>
                    </StackItem>
                  </Stack>
                </Stack>
              </>
            )}
          {appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Loading && (
            <>
              <Stack>
                <Stack
                  horizontal
                  horizontalAlign="center"
                  verticalAlign="center"
                  style={{ width: '100%', marginTop: 10 }}>
                  <StackItem style={{ justifyContent: 'center', alignItems: 'center' }}>
                    <Spinner
                      style={{ alignSelf: 'flex-start', height: '100%', marginRight: '5px' }}
                      size={SpinnerSize.medium}
                      aria-label={t('chatHistory.loadingAriaLabel1')}
                    />
                  </StackItem>
                  <StackItem>
                    <Text style={{ alignSelf: 'center', fontWeight: '400', fontSize: 14 }}>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{t('chatHistory.loading')}</span>
                    </Text>
                  </StackItem>
                </Stack>
              </Stack>
            </>
          )}
        </Stack>
      </Stack>
      <Dialog
        hidden={hideClearAllDialog}
        onDismiss={clearing ? () => {} : onHideClearAllDialog}
        dialogContentProps={clearAllDialogContentProps}
        modalProps={modalProps}>
        <DialogFooter>
          {!clearingError && (
            <PrimaryButton onClick={onClearAllChatHistory} disabled={clearing} text={t('chatHistory.clearAllButton')} />
          )}
          <DefaultButton
            onClick={onHideClearAllDialog}
            disabled={clearing}
            text={!clearingError ? t('cancel') : t('close')}
          />
        </DialogFooter>
      </Dialog>
    </section>
  )
}
