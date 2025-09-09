import React, { createContext, useContext, useState, ReactNode } from 'react'

interface JobStatus {
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  fileType: 'pdf' | 'xml'
  filenames: string[] // Changed from filename to filenames (array)
  progress?: number
  total?: number
}

interface BackgroundJobsContextType {
  jobs: JobStatus[]
  addJob: (job: Omit<JobStatus, 'progress' | 'total'> & { progress?: number; total?: number }) => void
  updateJob: (job_id: string, updates: Partial<JobStatus>) => void
  removeJob: (job_id: string) => void
  canAddJob: () => boolean
}

const BackgroundJobsContext = createContext<BackgroundJobsContextType | undefined>(undefined)

export const BackgroundJobsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const MAX_CONCURRENT_JOBS = 5 // Add this constant

  const addJob = (job: Omit<JobStatus, 'progress' | 'total'>) => {
    setJobs(prev => [...prev, { ...job, progress: 0, total: 0 }])
  }

  const updateJob = (job_id: string, updates: Partial<JobStatus>) => {
    setJobs(prev => prev.map(job => (job.job_id === job_id ? { ...job, ...updates } : job)))
  }

  const removeJob = (job_id: string) => {
    setJobs(prev => prev.filter(job => job.job_id !== job_id))
  }

  // Add this new method to check if we can add more jobs
  const canAddJob = () => {
    const activeJobs = jobs.filter(job => job.status === 'queued' || job.status === 'processing')
    return activeJobs.length < MAX_CONCURRENT_JOBS
  }

  return (
    <BackgroundJobsContext.Provider value={{ jobs, addJob, updateJob, removeJob, canAddJob }}>
      {children}
    </BackgroundJobsContext.Provider>
  )
}

export const useBackgroundJobs = () => {
  const context = useContext(BackgroundJobsContext)
  if (!context) {
    throw new Error('useBackgroundJobs must be used within a BackgroundJobsProvider')
  }
  return context
}
