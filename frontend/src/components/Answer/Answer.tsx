import { FormEvent, useContext, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { nord } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Checkbox, DefaultButton, Dialog, FontIcon, Stack, Text } from '@fluentui/react'
import { useBoolean } from '@fluentui/react-hooks'
import { ThumbDislike20Filled, ThumbLike20Filled } from '@fluentui/react-icons'
import DOMPurify from 'dompurify'
import remarkGfm from 'remark-gfm'
import supersub from 'remark-supersub'
import { AskResponse, Citation, Feedback, historyMessageFeedback } from '../../api'
import { XSSAllowTags, XSSAllowAttributes } from '../../constants/sanatizeAllowables'
import { AppStateContext } from '../../state/AppProvider'

import { parseAnswer } from './AnswerParser'

import styles from './Answer.module.css'
import { useLanguage } from '../../state/LanguageContext'

interface Props {
  answer: AskResponse
  onCitationClicked: (citedDocument: Citation) => void
  onExectResultClicked: (answerId: string) => void
  sendFollowupQuestion: (question: string) => void
}

export const Answer = ({ answer, onCitationClicked, onExectResultClicked, sendFollowupQuestion }: Props) => {
  const { t } = useLanguage()
  const initializeAnswerFeedback = (answer: AskResponse) => {
    if (answer.message_id == undefined) return undefined
    if (answer.feedback == undefined) return undefined
    if (answer.feedback.split(',').length > 1) return Feedback.Negative
    if (Object.values(Feedback).includes(answer.feedback)) return answer.feedback
    return Feedback.Neutral
  }

  const [isRefAccordionOpen, { toggle: toggleIsRefAccordionOpen }] = useBoolean(false)
  const filePathTruncationLimit = 50

  const parsedAnswer = useMemo(() => parseAnswer(answer), [answer])
  const answerOnly = parsedAnswer?.markdownFormatText?.includes('Anschlussfragen:')
    ? parsedAnswer.markdownFormatText.split('Anschlussfragen:')[0]
    : parsedAnswer?.markdownFormatText
  const followups = parsedAnswer?.markdownFormatText?.includes('Anschlussfragen:')
    ? (parsedAnswer.markdownFormatText.split('Anschlussfragen:')[1] || '').split('- ')
    : []
  const [chevronIsExpanded, setChevronIsExpanded] = useState(isRefAccordionOpen)
  const [feedbackState, setFeedbackState] = useState(initializeAnswerFeedback(answer))
  const [isFeedbackDialogOpen, setIsFeedbackDialogOpen] = useState(false)
  const [showReportInappropriateFeedback, setShowReportInappropriateFeedback] = useState(false)
  const [negativeFeedbackList, setNegativeFeedbackList] = useState<Feedback[]>([])
  const appStateContext = useContext(AppStateContext)
  const FEEDBACK_ENABLED =
    appStateContext?.state.frontendSettings?.feedback_enabled && appStateContext?.state.isCosmosDBAvailable?.cosmosDB
  const SANITIZE_ANSWER = appStateContext?.state.frontendSettings?.sanitize_answer

  const handleChevronClick = () => {
    setChevronIsExpanded(!chevronIsExpanded)
    toggleIsRefAccordionOpen()
  }

  useEffect(() => {
    setChevronIsExpanded(isRefAccordionOpen)
  }, [isRefAccordionOpen])

  useEffect(() => {
    if (answer.message_id == undefined) return

    let currentFeedbackState
    if (appStateContext?.state.feedbackState && appStateContext?.state.feedbackState[answer.message_id]) {
      currentFeedbackState = appStateContext?.state.feedbackState[answer.message_id]
    } else {
      currentFeedbackState = initializeAnswerFeedback(answer)
    }
    setFeedbackState(currentFeedbackState)
  }, [appStateContext?.state.feedbackState, feedbackState, answer.message_id])

  const createCitationFilepath = (citation: Citation, index: number, truncate: boolean = false) => {
    let citationFilename = ''

    if (citation.filepath) {
      const part_i = citation.part_index ?? (citation.chunk_id ? parseInt(citation.chunk_id) + 1 : '')
      if (truncate && citation.filepath.length > filePathTruncationLimit) {
        const citationLength = citation.filepath.length
        // citationFilename = `${citation.filepath.substring(0, 20)}...${citation.filepath.substring(citationLength - 20)} - Part ${part_i}`
        citationFilename = `${citation.filepath.substring(0, 20)}...${citation.filepath.substring(citationLength - 20)} - ${citation.title}`
      } else {
        // citationFilename = `${citation.filepath} - Part ${part_i}`
        citationFilename = `${citation.filepath} - ${citation.title}`
      }
    } else if (citation.filepath && citation.reindex_id) {
      // citationFilename = `${citation.filepath} - Part ${citation.reindex_id}`
      citationFilename = `${citation.filepath} - ${citation.title}`
    } else {
      citationFilename = t('answer.citationLabel', { index: index + 1 })
    }
    return citationFilename
  }

  const onCitationClicked2 = (citation: Citation) => {
    if (!citation.filepath) {
      console.error('File path is missing')
      return
    }

    // Extract the page number from the citation title (e.g., "Page 47")
    const pageNumberMatch = citation.title?.match(/Page (\d+)/)
    if (!pageNumberMatch) {
      console.error('Page number not found in citation title')
      return
    }
    const pageNumber = parseInt(pageNumberMatch[1], 10) // Extracted page number

    // Construct the URL with the page fragment
    const pdfUrl = `/get-pdf?file_name=${answer.organization ? answer.organization + '/' : ''}${encodeURIComponent(citation.filepath)}#page=${pageNumber}`
    window.open(pdfUrl, '_blank')
  }

  // const createCitationFilepath = (citation: Citation, index: number, truncate: boolean = false) => {
  //   let citationFilename = ''

  //   if (citation.filepath) {
  //     const part_i = citation.part_index ?? (citation.chunk_id ? parseInt(citation.chunk_id) + 1 : '')
  //     if (truncate && citation.filepath.length > filePathTruncationLimit) {
  //       const citationLength = citation.filepath.length
  //       citationFilename = `${citation.filepath.substring(0, 20)}...${citation.filepath.substring(citationLength - 20)}`
  //     } else {
  //       citationFilename = `${citation.filepath}`
  //     }
  //   } else if (citation.filepath && citation.reindex_id) {
  //     citationFilename = `${citation.filepath}`
  //   } else {
  //     citationFilename = `Citation ${index}`
  //   }
  //   citationFilename = `https://pinkvoss-verlag-staging.publishone.nl/document/${citationFilename}/content`
  //   return citationFilename
  // }

  const createCitationTitle = (citation: Citation, index: number, truncate: boolean = false) => {
    let citationTitle = ''
    console.log('citation.part_index', citation.part_index)
    console.log('citation.reindex_id', citation.reindex_id)
    console.log('citation.id', citation.id)

    if (citation.title) {
      const part_i = citation.part_index ?? (citation.chunk_id ? parseInt(citation.chunk_id) + 1 : '')
      if (truncate && citation.title.length > filePathTruncationLimit) {
        const citationLength = citation.title.length
        citationTitle = `${citation.title.substring(0, 20)}...${citation.title.substring(citationLength - 20)} - Part ${part_i}`
      } else {
        citationTitle = part_i == 1 ? citation.title : `${citation.title} - Part ${part_i}`
      }
    } else if (citation.title && citation.reindex_id) {
      citationTitle = citation.reindex_id == '1' ? citation.title : `${citation.title} - Part ${citation.reindex_id}`
    } else {
      citationTitle = t('answer.citationLabel', { index: index + 1 })
    }
    return citationTitle
  }

  const onLikeResponseClicked = async () => {
    if (answer.message_id == undefined) return

    let newFeedbackState = feedbackState
    // Set or unset the thumbs up state
    if (feedbackState == Feedback.Positive) {
      newFeedbackState = Feedback.Neutral
    } else {
      newFeedbackState = Feedback.Positive
    }
    appStateContext?.dispatch({
      type: 'SET_FEEDBACK_STATE',
      payload: { answerId: answer.message_id, feedback: newFeedbackState }
    })
    setFeedbackState(newFeedbackState)

    // Update message feedback in db
    await historyMessageFeedback(answer.message_id, newFeedbackState)
  }

  const onDislikeResponseClicked = async () => {
    if (answer.message_id == undefined) return

    let newFeedbackState = feedbackState
    if (feedbackState === undefined || feedbackState === Feedback.Neutral || feedbackState === Feedback.Positive) {
      newFeedbackState = Feedback.Negative
      setFeedbackState(newFeedbackState)
      setIsFeedbackDialogOpen(true)
    } else {
      // Reset negative feedback to neutral
      newFeedbackState = Feedback.Neutral
      setFeedbackState(newFeedbackState)
      await historyMessageFeedback(answer.message_id, Feedback.Neutral)
    }
    appStateContext?.dispatch({
      type: 'SET_FEEDBACK_STATE',
      payload: { answerId: answer.message_id, feedback: newFeedbackState }
    })
  }

  const updateFeedbackList = (ev?: FormEvent<HTMLElement | HTMLInputElement>, checked?: boolean) => {
    if (answer.message_id == undefined) return
    const selectedFeedback = (ev?.target as HTMLInputElement)?.id as Feedback

    let feedbackList = negativeFeedbackList.slice()
    if (checked) {
      feedbackList.push(selectedFeedback)
    } else {
      feedbackList = feedbackList.filter(f => f !== selectedFeedback)
    }

    setNegativeFeedbackList(feedbackList)
  }

  const onSubmitNegativeFeedback = async () => {
    if (answer.message_id == undefined) return
    await historyMessageFeedback(answer.message_id, negativeFeedbackList.join(','))
    resetFeedbackDialog()
  }

  const resetFeedbackDialog = () => {
    setIsFeedbackDialogOpen(false)
    setShowReportInappropriateFeedback(false)
    setNegativeFeedbackList([])
  }

  const UnhelpfulFeedbackContent = () => {
    return (
      <>
        <div>{t('feedback.unhelpfulPrompt')}</div>
        <Stack tokens={{ childrenGap: 4 }}>
          <Checkbox
            label={t('feedback.missingCitation')}
            id={Feedback.MissingCitation}
            defaultChecked={negativeFeedbackList.includes(Feedback.MissingCitation)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.wrongCitation')}
            id={Feedback.WrongCitation}
            defaultChecked={negativeFeedbackList.includes(Feedback.WrongCitation)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.outOfScope')}
            id={Feedback.OutOfScope}
            defaultChecked={negativeFeedbackList.includes(Feedback.OutOfScope)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.inaccurateOrIrrelevant')}
            id={Feedback.InaccurateOrIrrelevant}
            defaultChecked={negativeFeedbackList.includes(Feedback.InaccurateOrIrrelevant)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.otherUnhelpful')}
            id={Feedback.OtherUnhelpful}
            defaultChecked={negativeFeedbackList.includes(Feedback.OtherUnhelpful)}
            onChange={updateFeedbackList}></Checkbox>
        </Stack>
        <div onClick={() => setShowReportInappropriateFeedback(true)} style={{ color: '#115EA3', cursor: 'pointer' }}>
          {t('feedback.reportInappropriate')}
        </div>
      </>
    )
  }

  const ReportInappropriateFeedbackContent = () => {
    return (
      <>
        <div>
          {t('feedback.contentIs')} <span style={{ color: 'red' }}>*</span>
        </div>
        <Stack tokens={{ childrenGap: 4 }}>
          <Checkbox
            label={t('feedback.hateSpeech')}
            id={Feedback.HateSpeech}
            defaultChecked={negativeFeedbackList.includes(Feedback.HateSpeech)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.violent')}
            id={Feedback.Violent}
            defaultChecked={negativeFeedbackList.includes(Feedback.Violent)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.sexual')}
            id={Feedback.Sexual}
            defaultChecked={negativeFeedbackList.includes(Feedback.Sexual)}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.manipulative')}
            defaultChecked={negativeFeedbackList.includes(Feedback.Manipulative)}
            id={Feedback.Manipulative}
            onChange={updateFeedbackList}></Checkbox>
          <Checkbox
            label={t('feedback.otherHarmful')}
            id={Feedback.OtherHarmful}
            defaultChecked={negativeFeedbackList.includes(Feedback.OtherHarmful)}
            onChange={updateFeedbackList}></Checkbox>
        </Stack>
      </>
    )
  }

  const components = {
    code({ node, ...props }: { node: any; [key: string]: any }) {
      let language
      if (props.className) {
        const match = props.className.match(/language-(\w+)/)
        language = match ? match[1] : undefined
      }
      const codeString = node.children[0].value ?? ''
      return (
        <SyntaxHighlighter style={nord} language={language} PreTag="div" {...props}>
          {codeString}
        </SyntaxHighlighter>
      )
    }
  }
  return (
    <>
      <Stack className={styles.answerContainer} tabIndex={0}>
        <Stack.Item>
          <Stack horizontal grow>
            <Stack.Item grow>
              {parsedAnswer && (
                <>
                  <ReactMarkdown
                    linkTarget="_blank"
                    remarkPlugins={[remarkGfm, supersub]}
                    children={
                      SANITIZE_ANSWER
                        ? DOMPurify.sanitize(answerOnly ?? '', {
                            ALLOWED_TAGS: XSSAllowTags,
                            ALLOWED_ATTR: XSSAllowAttributes
                          })
                        : answerOnly ?? ''
                    }
                    className={styles.answerText}
                    components={components}
                  />
                  <div className={styles.followup}>
                    {followups.length > 0 && <div className={styles.followupHeading}>Anschlussfragen:</div>}
                    {followups
                      .filter(question => question.trim())
                      .map(question => (
                        <div className={styles.followupSingle} onClick={() => sendFollowupQuestion(question)}>
                          {question}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </Stack.Item>
            <Stack.Item className={styles.answerHeader}>
              {FEEDBACK_ENABLED && answer.message_id !== undefined && (
                <Stack horizontal horizontalAlign="space-between">
                  <ThumbLike20Filled
                    aria-hidden="false"
                    aria-label={t('feedback.likeLabel')}
                    onClick={() => onLikeResponseClicked()}
                    style={
                      feedbackState === Feedback.Positive ||
                      appStateContext?.state.feedbackState[answer.message_id] === Feedback.Positive
                        ? { color: 'darkgreen', cursor: 'pointer' }
                        : { color: 'slategray', cursor: 'pointer' }
                    }
                  />
                  <ThumbDislike20Filled
                    aria-hidden="false"
                    aria-label={t('feedback.dislikeLabel')}
                    onClick={() => onDislikeResponseClicked()}
                    style={
                      feedbackState !== Feedback.Positive &&
                      feedbackState !== Feedback.Neutral &&
                      feedbackState !== undefined
                        ? { color: 'darkred', cursor: 'pointer' }
                        : { color: 'slategray', cursor: 'pointer' }
                    }
                  />
                </Stack>
              )}
            </Stack.Item>
          </Stack>
        </Stack.Item>
        {parsedAnswer?.generated_chart !== null && (
          <Stack className={styles.answerContainer}>
            <Stack.Item grow>
              <img src={`data:image/png;base64, ${parsedAnswer?.generated_chart}`} />
            </Stack.Item>
          </Stack>
        )}
        <Stack horizontal className={styles.answerFooter}>
          {!!parsedAnswer?.citations.length && (
            <Stack.Item onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? toggleIsRefAccordionOpen() : null)}>
              <Stack style={{ width: '100%' }}>
                <Stack horizontal horizontalAlign="start" verticalAlign="center">
                  <Text
                    className={styles.accordionTitle}
                    onClick={toggleIsRefAccordionOpen}
                    aria-label={t('answer.openReferences')}
                    tabIndex={0}
                    role="button">
                    <span>
                      {parsedAnswer.citations.length > 1
                        ? t('answer.multipleSources', { count: parsedAnswer.citations.length })
                        : t('answer.singleSource')}
                    </span>
                  </Text>
                  <FontIcon
                    className={styles.accordionIcon}
                    onClick={handleChevronClick}
                    iconName={chevronIsExpanded ? 'ChevronDown' : 'ChevronRight'}
                  />
                </Stack>
              </Stack>
            </Stack.Item>
          )}
          <Stack.Item className={styles.answerDisclaimerContainer}>
            <span className={styles.answerDisclaimer}>{t('answer.disclaimer')}</span>
          </Stack.Item>
          {!!answer.exec_results?.length && (
            <Stack.Item onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? toggleIsRefAccordionOpen() : null)}>
              <Stack style={{ width: '100%' }}>
                <Stack horizontal horizontalAlign="start" verticalAlign="center">
                  <Text
                    className={styles.accordionTitle}
                    onClick={() => onExectResultClicked(answer.message_id ?? '')}
                    aria-label={t('answer.openIntents')}
                    tabIndex={0}
                    role="button">
                    <span>{t('answer.showIntents')}</span>
                  </Text>
                  <FontIcon className={styles.accordionIcon} onClick={handleChevronClick} iconName={'ChevronRight'} />
                </Stack>
              </Stack>
            </Stack.Item>
          )}
        </Stack>
        {chevronIsExpanded && (
          <div className={styles.citationWrapper}>
            {parsedAnswer?.citations.map((citation, index) => {
              console.log('citation:', citation)
              const idx = index + 1
              const isPdf = citation.filepath?.toLowerCase().endsWith('.pdf')

              const label = isPdf ? createCitationFilepath(citation, idx, true) : citation.title ?? ''

              const handleClick = () => {
                if (isPdf) {
                  onCitationClicked2(citation)
                } else {
                  window.open(`https://amsterdam.publishone.nl/document/${citation.filepath}/content`, '_blank')
                }
              }

              return (
                <span
                  title={label}
                  tabIndex={0}
                  role="link"
                  key={idx}
                  onClick={handleClick}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick()}
                  className={styles.citationContainer}
                  aria-label={label}>
                  <div className={styles.citation}>{idx}</div>
                  {label}
                </span>
              )

              // const citationFilepath = createCitationFilepath(citation, idx)
              // const citationTitle = createCitationTitle(citation, idx)
              // return (
              //   <span
              //     title={citationTitle}
              //     tabIndex={0}
              //     role="link"
              //     key={idx}
              //     onClick={() => window.open(citationFilepath, '_blank')} // Open citation URL in a new tab
              //     onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? window.open(citationFilepath, '_blank') : null)} // Handle keyboard navigation
              //     className={styles.citationContainer}
              //     aria-label={citationTitle}>
              //     <div className={styles.citation}>{idx + 1}</div> {/* Adjusted to start index from 1 */}
              //     {citationTitle}
              //   </span>
              // )
            })}
          </div>
        )}
      </Stack>
      <Dialog
        onDismiss={() => {
          resetFeedbackDialog()
          setFeedbackState(Feedback.Neutral)
        }}
        hidden={!isFeedbackDialogOpen}
        styles={{
          main: [
            {
              selectors: {
                ['@media (min-width: 480px)']: {
                  maxWidth: '600px',
                  background: '#FFFFFF',
                  boxShadow: '0px 14px 28.8px rgba(0, 0, 0, 0.24), 0px 0px 8px rgba(0, 0, 0, 0.2)',
                  borderRadius: '8px',
                  maxHeight: '600px',
                  minHeight: '100px'
                }
              }
            }
          ]
        }}
        dialogContentProps={{
          title: t('feedback.sendFeedback'),
          showCloseButton: true
        }}>
        <Stack tokens={{ childrenGap: 4 }}>
          <div>{t('feedback.helpImprove')}</div>

          {!showReportInappropriateFeedback ? <UnhelpfulFeedbackContent /> : <ReportInappropriateFeedbackContent />}

          <div>{t('feedback.submitNotice')}</div>

          <DefaultButton disabled={negativeFeedbackList.length < 1} onClick={onSubmitNegativeFeedback}>
            {t('feedback.submit')}
          </DefaultButton>
        </Stack>
      </Dialog>
    </>
  )
}
