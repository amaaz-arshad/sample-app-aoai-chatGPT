import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import Navbar from '../../components/Navbar/Navbar'

const SystemMessage: React.FC = () => {
  const [systemMessage, setSystemMessage] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false) // State for button loading

  // Fetch the system message when the component mounts
  useEffect(() => {
    const fetchSystemMessage = async () => {
      try {
        const response = await axios.get('/system_message')
        setSystemMessage(response.data.system_message)
      } catch (error) {
        console.error('Error fetching system message', error)
        toast.error('Error fetching system message')
      }
    }

    fetchSystemMessage()
  }, [])

  // Handle form submission to update the system message
  const handleUpdateMessage = async () => {
    if (!newMessage) {
      toast.error('System message cannot be empty')
      return
    }

    setLoading(true) // Set loading state to true when starting the update request

    try {
      const response = await axios.post('/system_message', {
        system_message: newMessage
      })
      toast.success('System message updated successfully')
      setSystemMessage(newMessage)
      setNewMessage('') // Clear the input after submission
    } catch (error) {
      console.error('Error updating system message', error)
      toast.error('Error updating system message')
    } finally {
      setLoading(false) // Set loading state back to false after the request is completed
    }
  }

  return (
    <div>
      <Navbar />

      <div className="container my-5">
        <h2>System Message</h2>
        {systemMessage ? (
          <div>
            <textarea
              className="form-control mb-3"
              value={newMessage || systemMessage}
              onChange={e => setNewMessage(e.target.value)}
              rows={10}
            />
          </div>
        ) : (
          <p>Loading system message...</p>
        )}
        <button
          className="btn btn-primary"
          onClick={handleUpdateMessage}
          disabled={loading} // Disable button when loading
        >
          {loading ? 'Updating...' : 'Update System Message'}
        </button>
      </div>
    </div>
  )
}

export default SystemMessage
