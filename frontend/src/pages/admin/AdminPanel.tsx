import React, { useEffect, useState } from 'react'
import { Table, Button, Spinner, Form, Tab, Tabs, Alert } from 'react-bootstrap'
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

interface UserCost {
  user_id: string
  user_name: string
  total_cost: number
  total_input_tokens: number
  total_output_tokens: number
  conversation_count: number
  last_updated: string
  first_created?: string
}

const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [userCosts, setUserCosts] = useState<UserCost[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [costsLoading, setCostsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [costsError, setCostsError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [activeTab, setActiveTab] = useState<string>('users')

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
      setUsers(data.value || [])
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  const fetchUserCosts = async () => {
    setCostsLoading(true)
    setCostsError(null)
    try {
      const response = await fetch('/costs/all')
      if (!response.ok) {
        const errData = await response.json()
        throw new Error(`Server returned ${response.status}: ${JSON.stringify(errData)}`)
      }
      const data = await response.json()
      setUserCosts(data || [])
    } catch (err: any) {
      setCostsError(err.message || 'Failed to fetch user costs')
    } finally {
      setCostsLoading(false)
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

  const refreshAll = () => {
    fetchUsers()
    if (activeTab === 'costs') {
      fetchUserCosts()
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  useEffect(() => {
    if (activeTab === 'costs') {
      fetchUserCosts()
    }
  }, [activeTab])

  const filteredUsers = users.filter(
    user =>
      user.displayName?.toLowerCase().includes(search.toLowerCase()) ||
      getEmail(user)?.toLowerCase().includes(search.toLowerCase()) ||
      user.streetAddress?.toLowerCase().includes(search.toLowerCase()) ||
      user.city?.toLowerCase().includes(search.toLowerCase())
  )

  const filteredCosts = userCosts.filter(
    cost =>
      cost.user_name?.toLowerCase().includes(search.toLowerCase()) ||
      cost.user_id?.toLowerCase().includes(search.toLowerCase())
  )

  // Combine user data with cost data for enriched view
  const enrichedCosts = filteredCosts.map(cost => {
    const user = users.find(u => u.id === cost.user_id)
    return {
      ...cost,
      user_displayName: user?.displayName,
      user_email: user ? getEmail(user) : '',
      user_streetAddress: user?.streetAddress,
      user_city: user?.city
    }
  })

  return (
    <div>
      <Navbar />
      <div className="container mt-4">
        <h2>Admin Panel</h2>

        <Tabs activeKey={activeTab} onSelect={tab => setActiveTab(tab || 'users')} className="mb-3">
          <Tab eventKey="users" title="B2C Users">
            <div className="d-flex mb-3">
              <Form.Control
                type="text"
                placeholder="Search users by any field..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="me-2"
              />
              <Button variant="primary" onClick={refreshAll} className="me-2">
                Refresh
              </Button>
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
          </Tab>

          <Tab eventKey="costs" title="User Costs">
            <div className="d-flex mb-3">
              <Form.Control
                type="text"
                placeholder="Search costs by user name or ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="me-2"
              />
              <Button variant="primary" onClick={refreshAll} className="me-2">
                Refresh
              </Button>
            </div>

            {costsLoading ? (
              <div className="text-center">
                <Spinner animation="border" />
                <p>Loading cost data...</p>
              </div>
            ) : costsError ? (
              <div className="alert alert-danger">{costsError}</div>
            ) : (
              <>
                <div className="mb-3">
                  <Alert variant="info">
                    <strong>Total across all users: </strong>$
                    {enrichedCosts.reduce((sum, cost) => sum + cost.total_cost, 0).toFixed(4)}
                    {' | '}
                    <strong>Total conversations: </strong>
                    {enrichedCosts.reduce((sum, cost) => sum + cost.conversation_count, 0)}
                    {' | '}
                    <strong>Total tokens: </strong>
                    {enrichedCosts
                      .reduce((sum, cost) => sum + cost.total_input_tokens + cost.total_output_tokens, 0)
                      .toLocaleString()}
                  </Alert>
                </div>

                <Table striped bordered hover responsive>
                  <thead>
                    <tr>
                      <th>User Name</th>
                      <th>Email</th>
                      <th>Total Cost</th>
                      <th>Conversations</th>
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                      <th>Total Tokens</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedCosts.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center">
                          No cost data available
                        </td>
                      </tr>
                    ) : (
                      enrichedCosts.map(cost => (
                        <tr key={cost.user_id}>
                          <td>{cost.user_displayName || cost.user_name || 'N/A'}</td>
                          <td>{cost.user_email || 'N/A'}</td>
                          <td>
                            <strong>${cost.total_cost.toFixed(4)}</strong>
                          </td>
                          <td>{cost.conversation_count}</td>
                          <td>{cost.total_input_tokens.toLocaleString()}</td>
                          <td>{cost.total_output_tokens.toLocaleString()}</td>
                          <td>
                            <strong>{(cost.total_input_tokens + cost.total_output_tokens).toLocaleString()}</strong>
                          </td>
                          <td>
                            {new Date(cost.last_updated).toLocaleDateString()}{' '}
                            {new Date(cost.last_updated).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </>
            )}
          </Tab>
        </Tabs>
      </div>
    </div>
  )
}

export default AdminPanel
