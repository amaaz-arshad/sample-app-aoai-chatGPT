import React, { useState, useEffect, useContext } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AppStateContext } from '../../state/AppProvider'
import Navbar from '../../components/Navbar/Navbar'
import { getUserInfo, UserInfo } from '../../api'
import { FILTER_FIELD, FILTER_FIELD2 } from '../../constants/variables'
import './FileUpload.css'
import { useAppUser } from '../../state/AppUserProvider'
import { useLanguage } from '../../state/LanguageContext'
import { useBackgroundJobs } from '../../state/BackgroundJobsContext'

// PDF.js for page counting
import * as pdfjs from 'pdfjs-dist'
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

// Job status types
type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

interface FileUploadResponse {
  files: string[]
}

interface JobStatusResponse {
  job_id: string
  status: JobStatus
  result?: {
    processed_files: string[]
    skipped_files: string[]
  }
  error?: string
  timestamp: string
}

const FREE_USER_PDF_PAGE_LIMIT = 20 // New constant for page limit

const FileUpload: React.FC = () => {
  const appStateContext = useContext(AppStateContext)
  const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled
  const { userInfo, authEnabled } = useAppUser()
  const { t } = useLanguage()
  const { addJob, updateJob, removeJob, canAddJob } = useBackgroundJobs()

  /* ------------------------------------------------------------------ */
  /*  state                                                             */
  /* ------------------------------------------------------------------ */
  const [files, setFiles] = useState<string[]>([])
  // using File[] for easier handling
  const [newFiles, setNewFiles] = useState<File[] | null>(null)
  const [uploading, setUploading] = useState<boolean>(false)
  const [organizationFilter, setOrganizationFilter] = useState<string>('all')
  const [showAuthMessage, setShowAuthMessage] = useState<boolean | undefined>()
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [userType, setUserType] = useState<string>('')
  const [totalPdfPages, setTotalPdfPages] = useState<number>(0)
  const [newFilesPageCount, setNewFilesPageCount] = useState<number>(0)
  const filesPerPage = 10

  /* ------------------------------------------------------------------ */
  /*  auth helper                                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!AUTH_ENABLED) {
      setShowAuthMessage(false)
      return
    }
    if (userInfo?.length === 0 && window.location.hostname !== '127.0.0.1') {
      setShowAuthMessage(true)
    } else {
      setShowAuthMessage(false)
    }
    if (userInfo && userInfo.length > 0) {
      const userTypeClaim = userInfo[0].user_claims.find(claim => claim.typ === FILTER_FIELD2)
      setUserType(userTypeClaim ? userTypeClaim.val.trim().toLowerCase() : '')
    }
  }, [AUTH_ENABLED, userInfo])

  /* ------------------------------------------------------------------ */
  /*  company / organisation helpers                                    */
  /* ------------------------------------------------------------------ */
  const getCompanyName = () => {
    if (userInfo?.[0]?.user_claims) {
      const claim = userInfo[0].user_claims.find(c => c.typ === FILTER_FIELD)
      return claim
        ? claim.val
            .trim()
            .toLowerCase()
            .replace(/^\.+|\.+$/g, '')
        : ''
    }
    return ''
  }

  const validateOrgName = async (): Promise<string | null> => {
    let org = getCompanyName()
    if (org === '') {
      const input = prompt(t('fileUpload.orgPrompt'))
      if (!input?.trim()) {
        toast.error(t('fileUpload.orgRequired'))
        return null
      }
      org = input
        .trim()
        .toLowerCase()
        .replace(/^\.+|\.+$/g, '')
    }
    return org
  }

  /* ------------------------------------------------------------------ */
  /*  list files                                                        */
  /* ------------------------------------------------------------------ */
  const fetchFiles = async () => {
    try {
      const companyName = getCompanyName()
      const { data } = await axios.get<FileUploadResponse>(`/pipeline/list?company=${encodeURIComponent(companyName)}`)
      setFiles(data.files)
    } catch {
      toast.error(t('fileUpload.fetchFailed'))
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [])

  /* ------------------------------------------------------------------ */
  /*  PDF page count helpers                                            */
  /* ------------------------------------------------------------------ */
  // Fetch PDF page count when component mounts or files change
  useEffect(() => {
    const fetchPdfPageCount = async () => {
      if (userType !== 'free-user') return

      try {
        const companyName = getCompanyName()
        const { data } = await axios.get<{ total_pages: number }>(
          `/pipeline/pdf_page_count?company=${encodeURIComponent(companyName)}`
        )
        setTotalPdfPages(data.total_pages)
      } catch (error) {
        console.error('Error fetching PDF page count:', error)
      }
    }

    fetchPdfPageCount()
  }, [files, userType])

  // Helper function to get PDF page count
  const getPdfPageCount = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async e => {
        try {
          const typedArray = new Uint8Array(e.target?.result as ArrayBuffer)
          const pdf = await pdfjs.getDocument(typedArray).promise
          resolve(pdf.numPages)
        } catch (error) {
          reject(error)
        }
      }
      reader.readAsArrayBuffer(file)
    })
  }

  // Calculate page count for new PDF files
  useEffect(() => {
    const calculateNewFilesPageCount = async () => {
      if (!newFiles || userType !== 'free-user') {
        setNewFilesPageCount(0)
        return
      }

      let pageCount = 0
      const pdfFiles = newFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'))

      for (const file of pdfFiles) {
        try {
          const pages = await getPdfPageCount(file)
          pageCount += pages
        } catch (error) {
          console.error('Error calculating PDF page count:', error)
        }
      }

      setNewFilesPageCount(pageCount)
    }

    calculateNewFilesPageCount()
  }, [newFiles, userType])

  // Check if free user has exceeded page limit
  const hasExceededPageLimit = userType === 'free-user' && totalPdfPages + newFilesPageCount > FREE_USER_PDF_PAGE_LIMIT

  /* ------------------------------------------------------------------ */
  /*  file input change                                                 */
  /*  (Cancel selection entirely if user selects more than remaining)   */
  /* ------------------------------------------------------------------ */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) {
      setNewFiles(null)
      return
    }

    const selected = Array.from(fileList)
    setNewFiles(selected)
  }

  /* ------------------------------------------------------------------ */
  /*  Job Polling Helper                                                */
  /* ------------------------------------------------------------------ */
  const startJobPolling = (job_id: string, fileType: 'pdf' | 'xml', filenames: string[]) => {
    const poll = async () => {
      try {
        const { data } = await axios.get<JobStatusResponse>(`/pipeline/job_status/${job_id}`)

        // Update job status in global context
        updateJob(job_id, {
          status: data.status,
          progress: data.result?.processed_files?.length || 0,
          total: (data.result?.processed_files?.length || 0) + (data.result?.skipped_files?.length || 0)
        })

        if (data.status === 'completed' || data.status === 'failed') {
          // REMOVED THE TOAST HERE - NAVBAR WILL HANDLE IT
          if (data.status === 'completed') {
            fetchFiles()
          }

          // Remove job after delay to show completion
          setTimeout(() => removeJob(job_id), 5000)
        } else {
          // Continue polling
          setTimeout(poll, 3000)
        }
      } catch (error) {
        console.error('Error polling job status:', error)
        setTimeout(poll, 3000)
      }
    }

    // Add job to global context
    addJob({
      job_id,
      status: 'queued',
      fileType,
      filenames,
      progress: 0,
      total: filenames.length
    })

    // Start polling
    poll()
  }

  /* ------------------------------------------------------------------ */
  /*  PDF upload                                                        */
  /* ------------------------------------------------------------------ */
  const handleUploadPdf = async () => {
    // Enforce job capacity first
    if (!canAddJob()) {
      toast.error(t('fileUpload.maxJobsReached'))
      return
    }

    if (!newFiles?.length) {
      toast.info(t('fileUpload.chooseFile'))
      return
    }

    // Check page limit for free users
    if (hasExceededPageLimit) {
      toast.error(
        t('fileUpload.freeUserPageLimitReached', {
          limit: FREE_USER_PDF_PAGE_LIMIT,
          current: totalPdfPages,
          adding: newFilesPageCount
        }) ||
          `Free users are limited to ${FREE_USER_PDF_PAGE_LIMIT} PDF pages total. Current: ${totalPdfPages}, Adding: ${newFilesPageCount}`
      )
      setNewFiles(null)
      ;(document.getElementById('file-input') as HTMLInputElement).value = ''
      return
    }

    // Filter to pdfs only
    const selectedFiles = newFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (selectedFiles.length === 0) {
      toast.info(t('fileUpload.pdfOnly'))
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    const formData = new FormData()
    selectedFiles.forEach(file => formData.append('files', file))
    formData.append('organization', organization)
    formData.append('user_type', userType) // Send user type to backend

    try {
      const { data } = await axios.post<{ job_id: string }>('/pipeline/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // Get filenames for notification
      const filenames = selectedFiles.map(f => f.name)

      // Start job tracking
      startJobPolling(data.job_id, 'pdf', filenames)
      toast.info(t('fileUpload.pdfProcessing'))
    } catch (error: any) {
      if (error.response?.data?.detail) {
        toast.error(error.response.data.detail)
      } else {
        toast.error(t('fileUpload.uploadError'))
      }
    } finally {
      setUploading(false)
      setNewFiles(null)
      ;(document.getElementById('file-input') as HTMLInputElement).value = ''
    }
  }

  /* ------------------------------------------------------------------ */
  /*  XML upload                                                        */
  /* ------------------------------------------------------------------ */
  const handleUploadXml = async () => {
    // Enforce job capacity first
    if (!canAddJob()) {
      toast.error(t('fileUpload.maxJobsReached'))
      return
    }

    if (!newFiles?.length) {
      toast.info(t('fileUpload.chooseFile'))
      return
    }

    // Filter to xml only
    const selectedFiles = newFiles.filter(f => f.name.toLowerCase().endsWith('.xml'))
    if (selectedFiles.length === 0) {
      toast.info(t('fileUpload.xmlOnly'))
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    const formData = new FormData()
    selectedFiles.forEach(file => formData.append('files', file))
    formData.append('organization', organization)

    try {
      const { data } = await axios.post<{ job_id: string }>('/pipeline/upload_xml', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // Get filenames for notification
      const filenames = selectedFiles.map(f => f.name)

      // Start job tracking
      startJobPolling(data.job_id, 'xml', filenames)
      toast.info(t('fileUpload.xmlProcessing'))
    } catch (error) {
      toast.error(t('fileUpload.uploadError'))
    } finally {
      setUploading(false)
      setNewFiles(null)
      ;(document.getElementById('file-input') as HTMLInputElement).value = ''
    }
  }

  /* ------------------------------------------------------------------ */
  /*  delete helpers                                                    */
  /* ------------------------------------------------------------------ */
  const handleDeleteAll = async () => {
    const isConfirmed = window.confirm(t('fileUpload.deleteAllConfirm'))
    if (!isConfirmed) return

    try {
      const formData = new FormData()
      formData.append('organizationFilter', organizationFilter)
      const companyName = getCompanyName()
      if (companyName) formData.append('companyClaim', companyName)

      const deletePromise = axios.delete(`/pipeline/delete_all`, { data: formData })

      toast.promise(deletePromise, {
        pending: t('fileUpload.deletingAll'),
        success: t('fileUpload.deleteAllSuccess'),
        error: t('fileUpload.deleteAllFailed')
      })

      await deletePromise
      await fetchFiles()
      setOrganizationFilter('all')
      setCurrentPage(1)
    } catch (error) {
      console.error(t('fileUpload.deleteError'), error)
      toast.error(t('fileUpload.unexpectedError'))
    }
  }

  const handleDeleteSingleFile = async (filename: string) => {
    const isConfirmed = window.confirm(t('fileUpload.deleteSingleConfirm', { filename }))
    if (!isConfirmed) return

    try {
      const deletePromise = axios.delete(`/pipeline/delete_file/${filename}`)

      toast.promise(deletePromise, {
        pending: t('fileUpload.deletingSingle', { filename }),
        success: t('fileUpload.deleteSingleSuccess', { filename }),
        error: {
          render({ data }: { data: any }) {
            const msg = data?.response?.data?.message || t('fileUpload.deleteSingleFailed', { filename })
            return msg
          }
        }
      })

      await deletePromise
      await fetchFiles()
      setOrganizationFilter('all')
    } catch (error) {}
  }

  /* ------------------------------------------------------------------ */
  /*  filter + pagination                                               */
  /* ------------------------------------------------------------------ */
  const companyName = getCompanyName()
  const organizations = companyName ? [] : Array.from(new Set(files.map(f => f.split('/')[0])))

  const filteredFiles = companyName
    ? files.filter(f => f.startsWith(`${companyName}/`))
    : organizationFilter === 'all'
      ? files
      : files.filter(f => f.startsWith(`${organizationFilter}/`))

  const indexOfLastFile = currentPage * filesPerPage
  const indexOfFirstFile = indexOfLastFile - filesPerPage
  const currentFiles = filteredFiles.slice(indexOfFirstFile, indexOfLastFile)
  const totalPages = Math.ceil(filteredFiles.length / filesPerPage)

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(p => p + 1)
  }
  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(p => p - 1)
  }

  /* ------------------------------------------------------------------ */
  /*  render                                                            */
  /* ------------------------------------------------------------------ */
  return (
    <>
      <Navbar />
      <div className="main-container">
        <div className="file-upload-container">
          <div className="upload-section">
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf,.xml,application/pdf,text/xml"
              onChange={handleFileChange}
              className="file-input"
              disabled={uploading || hasExceededPageLimit}
            />
            {/* PDF button */}
            <button
              onClick={handleUploadPdf}
              className="btn btn-primary"
              disabled={uploading || hasExceededPageLimit}
              style={{ backgroundColor: '#00CC96', borderColor: '#00CC96' }}>
              {uploading ? t('fileUpload.processing') : t('fileUpload.uploadPdfButton')}
            </button>

            {/* XML button - hidden for free users */}
            {userType !== 'free-user' && (
              <button
                onClick={handleUploadXml}
                className="btn btn-primary"
                disabled={uploading}
                style={{ backgroundColor: '#006DCC', borderColor: '#006DCC' }}>
                {uploading ? t('fileUpload.processing') : t('fileUpload.uploadXmlButton')}
              </button>
            )}

            {/* Delete all */}
            <button onClick={handleDeleteAll} className="btn btn-danger" disabled={files.length === 0 || uploading}>
              {t('fileUpload.deleteAllButton')}
            </button>

            {/* show free-user page limit message */}
            {hasExceededPageLimit && (
              <p className="upload-limit-message" style={{ marginTop: 8, color: '#b02a37' }}>
                {t('fileUpload.freeUserPageLimitReached', {
                  limit: FREE_USER_PDF_PAGE_LIMIT,
                  current: totalPdfPages,
                  adding: newFilesPageCount
                }) ||
                  `Free users are limited to ${FREE_USER_PDF_PAGE_LIMIT} PDF pages total. Current: ${totalPdfPages}, Adding: ${newFilesPageCount}`}
              </p>
            )}
          </div>

          {/* Filter by organisation */}
          {!companyName && (
            <div className="filter-section mb-3">
              <label htmlFor="organization-filter">{t('fileUpload.filterLabel')} &nbsp;</label>
              <select
                id="organization-filter"
                value={organizationFilter}
                onChange={e => {
                  setOrganizationFilter(e.target.value)
                  setCurrentPage(1)
                }}>
                <option value="all">{t('fileUpload.allOrganizations')}</option>
                {organizations.map((org, i) => (
                  <option key={i} value={org}>
                    {org}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* file list */}
          <div className="file-list">
            <h3>{t('fileUpload.uploadedFiles')}</h3>
            {currentFiles.length === 0 ? (
              <p>{t('fileUpload.noFiles')}</p>
            ) : (
              <ul>
                {currentFiles.map((file, i) => (
                  <li
                    key={i}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span>{file}</span>
                    <button
                      onClick={() => handleDeleteSingleFile(file)}
                      className="btn btn-secondary"
                      disabled={uploading}>
                      {t('fileUpload.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* pagination */}
            {filteredFiles.length > filesPerPage && (
              <div className="pagination-controls" style={{ marginTop: '10px' }}>
                <button onClick={handlePrevPage} className="btn btn-light" disabled={currentPage === 1}>
                  {t('fileUpload.prevPage')}
                </button>
                <span style={{ margin: '0 10px' }}>
                  {t('fileUpload.pageInfo', { current: currentPage, total: totalPages })}
                </span>
                <button onClick={handleNextPage} className="btn btn-light" disabled={currentPage === totalPages}>
                  {t('fileUpload.nextPage')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default FileUpload
