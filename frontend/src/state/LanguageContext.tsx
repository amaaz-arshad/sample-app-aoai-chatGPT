import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Language } from '../constants/types'
import { translations } from '../constants/variables'

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, replacements?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('de')

  useEffect(() => {
    // Load saved language from localStorage
    const savedLang = localStorage.getItem('appLanguage') as Language | null
    if (savedLang && ['en', 'de'].includes(savedLang)) {
      setLanguage(savedLang)
    }
  }, [])

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang)
    localStorage.setItem('appLanguage', lang)
  }

  const t = (key: string, replacements?: Record<string, string | number>) => {
    let translation = translations[language][key] || key
    if (replacements) {
      Object.keys(replacements).forEach(k => {
        const value = replacements[k]
        translation = translation.replace(`{${k}}`, typeof value === 'number' ? value.toString() : value)
      })
    }
    return translation
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
