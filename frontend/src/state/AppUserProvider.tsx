import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react'
import { getUserInfo, UserInfo } from '../api'
import Loading from '../components/common/Loading'

interface AppUserContextProps {
  userInfo: UserInfo[] | null
  setUserInfo: (userInfo: UserInfo[]) => void
  authEnabled: boolean
}

const AppUserContext = createContext<AppUserContextProps | undefined>(undefined)

export const AppUserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userInfo, setUserInfo] = useState<UserInfo[] | null>(null)
  const [authEnabled, setAuthEnabled] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)

  // Fetch user info only once on app load
  const fetchUserInfo = async () => {
    try {
      const userInfoList = await getUserInfo()
      setUserInfo(userInfoList)
    } catch (e) {
      console.error('Failed to load user info', e)
    } finally {
      setLoading(false)
    }
  }

  // Check for authentication settings (you can expand this logic as needed)
  useEffect(() => {
    const authStatus = true // replace with real auth status
    setAuthEnabled(authStatus)

    if (authStatus && !userInfo) {
      fetchUserInfo()
    } else {
      setLoading(false)
    }
  }, [authEnabled, userInfo])

  if (loading) {
    return <Loading />
  }

  return <AppUserContext.Provider value={{ userInfo, setUserInfo, authEnabled }}>{children}</AppUserContext.Provider>
}

export const useAppUser = () => {
  const context = useContext(AppUserContext)
  if (!context) {
    throw new Error('useAppUser must be used within an AppUserProvider')
  }
  return context
}
