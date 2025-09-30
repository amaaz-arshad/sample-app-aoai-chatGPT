import React, { useEffect, useState } from 'react'
import { Table, Button, Spinner, Form } from 'react-bootstrap'
import Navbar from '../../components/Navbar/Navbar'

interface Identity {
  signInType: string
  issuer: string
  issuerAssignedId: string
}

interface User {
  id: string
  displayName?: string
  userPrincipalName?: string
  identities?: Identity[]
  streetAddress?: string
  city?: string
}

const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')

  const fetchUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/users/list')
      if (!response.ok) {
        const errData = await response.json()
        throw new Error(`Server returned ${response.status}: ${JSON.stringify(errData)}`)
      }
      const data = await response.json()
      // Adjust Graph API response shape
      setUsers(data.value || [])
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  const getEmail = (user: User): string => {
    // Prefer identity with signInType = "emailAddress"
    const emailIdentity = user.identities?.find(i => i.signInType === 'emailAddress')
    if (emailIdentity) return emailIdentity.issuerAssignedId

    // Fallbacks
    if (user.userPrincipalName) return user.userPrincipalName
    if (user.identities && user.identities.length > 0) {
      return user.identities[0].issuerAssignedId
    }

    return ''
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const filteredUsers = users.filter(
    user =>
      user.displayName?.toLowerCase().includes(search.toLowerCase()) ||
      getEmail(user)?.toLowerCase().includes(search.toLowerCase()) ||
      user.streetAddress?.toLowerCase().includes(search.toLowerCase()) ||
      user.city?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <Navbar />
      <div className="container mt-4">
        <h2>Azure B2C Users</h2>

        <div className="d-flex mb-3">
          <Form.Control
            type="text"
            placeholder="Search users by any field..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="me-2"
          />
          <Button variant="primary" onClick={fetchUsers} className="me-2">
            Refresh
          </Button>
          {/* <Button variant="success" onClick={handleExportCSV} className="me-2">
          Export CSV
        </Button>
        <Button variant="secondary" onClick={handleCopyToClipboard}>
          Copy to Clipboard
        </Button> */}
        </div>

        {loading ? (
          <div className="text-center">
            <Spinner animation="border" />
            <p>Loading users...</p>
          </div>
        ) : error ? (
          <div className="alert alert-danger">{error}</div>
        ) : (
          <Table striped bordered hover responsive>
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Email</th>
                <th>User Type</th>
                <th>Organization</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(user => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td>{getEmail(user)}</td>
                  <td>{user.streetAddress}</td>
                  <td>{user.city}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  )
}

export default AdminPanel
