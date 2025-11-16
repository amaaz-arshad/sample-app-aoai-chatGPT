import { useContext, useState } from 'react'
import styles from './QuestionInputLemon.module.css'
import { ChatMessage } from '../../api'
import { AppStateContext } from '../../state/AppProvider'
// import { FontIcon } from '@fluentui/react' // keep upload feature commented
// import { resizeImage } from '../../utils/resizeImage'
import Send from '../../assets/Send.svg'

interface Props {
  onSend: (question: ChatMessage['content'], id?: string) => void
  disabled: boolean
  placeholder?: string
  clearOnSend?: boolean
  conversationId?: string
}

export const QuestionInputLemon = ({ onSend, disabled, placeholder, clearOnSend, conversationId }: Props) => {
  const [question, setQuestion] = useState('')
  const [base64Image, setBase64Image] = useState<string | null>(null)
  const appStateContext = useContext(AppStateContext)
  // const OYD_ENABLED = appStateContext?.state.frontendSettings?.oyd_enabled || false

  const sendQuestion = () => {
    const q = question.trim()
    if (disabled || !q) return
    const payload: ChatMessage['content'] = base64Image
      ? [
          { type: 'text', text: q },
          { type: 'image_url', image_url: { url: base64Image } }
        ]
      : q
    conversationId ? onSend(payload, conversationId) : onSend(payload)
    setBase64Image(null)
    if (clearOnSend) setQuestion('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !(e.nativeEvent as any)?.isComposing) {
      e.preventDefault()
      sendQuestion()
    }
  }

  const disabledSend = disabled || question.trim().length === 0

  return (
    <div className={styles.questionInput}>
      <input
        className={styles.input}
        type="text"
        placeholder={placeholder}
        value={question}
        onChange={e => setQuestion(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-label="Ask a question"
      />

      {/* Image upload kept commented per request
      {!OYD_ENABLED && (
        <div className={styles.fileInputContainer}>
          <input type="file" id="fileInput" accept="image/*" className={styles.fileInput}
                 onChange={async (e) => {
                   const file = e.target.files?.[0]
                   if (!file) return
                   const toBase64 = (f: Blob) =>
                     new Promise<string>((res, rej) => {
                       const r = new FileReader()
                       r.onload = () => res(r.result as string)
                       r.onerror = rej
                       r.readAsDataURL(f)
                     })
                   setBase64Image(await toBase64(file))
                 }} />
          <label htmlFor="fileInput" className={styles.fileLabel} aria-label="Upload Image">
            <span className={styles.fileIcon}>📷</span>
          </label>
        </div>
      )} */}

      {base64Image && <img className={styles.preview} src={base64Image} alt="Uploaded Preview" />}

      <button className={styles.sendBtn} onClick={sendQuestion} disabled={disabledSend} aria-label="Send">
        <img src={Send} alt="" className={styles.sendIcon} />
      </button>
    </div>
  )
}
