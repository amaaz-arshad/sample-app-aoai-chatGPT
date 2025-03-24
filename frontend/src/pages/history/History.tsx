import React, { useEffect, useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import ReactMarkdown from 'react-markdown'
import './History.css'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import supersub from 'remark-supersub'
import DOMPurify from 'dompurify'
import { XSSAllowTags } from '../../constants/sanatizeAllowables'
import { Citation } from '../../api'
import { parseAnswer } from '../../components/Answer/AnswerParser'
import Modal from 'react-bootstrap/Modal'
import Button from 'react-bootstrap/Button'

interface ChatRow {
  timestamp: string
  system_message: string
  user_prompt: string
  assistant_answer: string
  citations?: Citation[]
}

const History: React.FC = () => {
  const [rows, setRows] = useState<ChatRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  
  // State for citation modal
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  const [isCitationModalOpen, setIsCitationModalOpen] = useState<boolean>(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/history_data')
        if (!response.ok) {
          throw new Error('Failed to fetch history')
        }
        const data: ChatRow[] = await response.json()
        setRows(data)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const formatTimestamp = (timestamp: string): string => {
    if (!timestamp) return ''
    const dateObj = new Date(timestamp)
    const year = dateObj.getFullYear()
    const month = String(dateObj.getMonth() + 1).padStart(2, '0')
    const day = String(dateObj.getDate()).padStart(2, '0')
    const hours = String(dateObj.getHours()).padStart(2, '0')
    const minutes = String(dateObj.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }

  const onCitationClick = (citation: Citation) => {
    setActiveCitation(citation)
    setIsCitationModalOpen(true)
  }

  return (
    <div className="history-page">
      <Navbar />
      {loading || error ? (
        <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
          {loading ? <div>Loading history...</div> : <div>Error: {error}</div>}
        </div>
      ) : (
        <div className="container py-4">
          <table className="table table-bordered" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '15%' }}>Timestamp</th>
                <th style={{ width: '30%' }}>System Message</th>
                <th style={{ width: '15%' }}>User</th>
                <th style={{ width: '40%' }}>Assistant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const askResponse = {
                  answer: row.assistant_answer,
                  citations: row.citations || [],
                  generated_chart: null
                }
                const parsedAnswer = parseAnswer(askResponse)
                return (
                  <tr key={index}>
                    <td style={{ verticalAlign: 'top', wordWrap: 'break-word' }}>
                      {formatTimestamp(row.timestamp)}
                    </td>
                    <td style={{ verticalAlign: 'top', wordWrap: 'break-word' }}>
                      <ReactMarkdown>{row.system_message}</ReactMarkdown>
                    </td>
                    <td style={{ verticalAlign: 'top', wordWrap: 'break-word' }}>
                      {row.user_prompt}
                    </td>
                    <td style={{ verticalAlign: 'top', wordWrap: 'break-word' }}>
                      {parsedAnswer ? (
                        <>
                          <ReactMarkdown
                            linkTarget="_blank"
                            children={DOMPurify.sanitize(parsedAnswer.markdownFormatText, {
                              ALLOWED_TAGS: XSSAllowTags
                            })}
                            remarkPlugins={[remarkGfm, supersub]}
                            rehypePlugins={[rehypeRaw]}
                          />
                          {parsedAnswer.citations && parsedAnswer.citations.length > 0 && (
                            <div className="citations" style={{ marginTop: '1em' }}>
                              <strong>References:</strong>
                              <ol style={{ marginTop: '0.5em' }}>
                                {parsedAnswer.citations.map((citation, idx) => (
                                  <li key={idx}>
                                    <span
                                      style={{
                                        cursor: 'pointer',
                                        color: 'blue',
                                        textDecoration: 'underline'
                                      }}
                                      onClick={() => onCitationClick(citation)}
                                    >
                                      {citation.title ? citation.title : `Citation ${idx + 1}`}
                                      {citation.filepath ? ` (${citation.filepath})` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}
                        </>
                      ) : (
                        <ReactMarkdown>{row.assistant_answer}</ReactMarkdown>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Citation Modal using react-bootstrap */}
          <Modal
            show={isCitationModalOpen}
            onHide={() => setIsCitationModalOpen(false)}
            dialogClassName="citation-modal"
            aria-labelledby="citation-modal-title"
          >
            <Modal.Header closeButton>
              <Modal.Title id="citation-modal-title" style={{ fontWeight: 'bold' }}>
                {activeCitation?.title}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {activeCitation && (
                <ReactMarkdown
                  linkTarget="_blank"
                  children={DOMPurify.sanitize(activeCitation.content, { ALLOWED_TAGS: XSSAllowTags })}
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                />
              )}
            </Modal.Body>
          </Modal>
        </div>
      )}
    </div>
  )
}

export default History
