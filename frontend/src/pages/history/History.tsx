import React, { useEffect, useState } from 'react'
import Navbar from '../../components/Navbar/Navbar'
import ReactMarkdown from 'react-markdown'
import './History.css'

interface ChatRow {
  timestamp: string
  system_message: string
  user_prompt: string
  assistant_answer: string
}

const History: React.FC = () => {
  const [rows, setRows] = useState<ChatRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="history-page">
      <Navbar />
      {loading || error ? (
        <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
          {loading ? <div>Loading history...</div> : <div>Error: {error}</div>}
        </div>
      ) : (
        <div className="container py-4">
          <table className="table table-bordered">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>System Message</th>
                <th>User</th>
                <th>Assistant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.timestamp}</td>
                  <td>
                    <ReactMarkdown>{row.system_message}</ReactMarkdown>
                  </td>
                  <td>{row.user_prompt}</td>
                  <td>
                    <ReactMarkdown>{row.assistant_answer}</ReactMarkdown>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default History
