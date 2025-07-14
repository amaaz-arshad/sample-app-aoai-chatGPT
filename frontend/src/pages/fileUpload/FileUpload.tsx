import React, { useState, useEffect, useContext } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AppStateContext } from '../../state/AppProvider'
import Navbar from '../../components/Navbar/Navbar'
import { getUserInfo, UserInfo } from '../../api'
import { FILTER_FIELD } from '../../constants/variables'
import './FileUpload.css'
import { useAppUser } from '../../state/AppUserProvider'
import { useLanguage } from '../../state/LanguageContext'
import { useBackgroundJobs } from '../../state/BackgroundJobsContext'

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

const FileUpload: React.FC = () => {
  const appStateContext = useContext(AppStateContext)
  const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled
  const { userInfo, authEnabled } = useAppUser()
  const { t } = useLanguage()
  const { addJob, updateJob, removeJob } = useBackgroundJobs()

  /* ------------------------------------------------------------------ */
  /*  state                                                             */
  /* ------------------------------------------------------------------ */
  const [files, setFiles] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState<boolean>(false)
  const [organizationFilter, setOrganizationFilter] = useState<string>('all')
  const [showAuthMessage, setShowAuthMessage] = useState<boolean | undefined>()
  const [currentPage, setCurrentPage] = useState<number>(1)
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
  /*  file input change                                                 */
  /* ------------------------------------------------------------------ */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setNewFiles(e.target.files)
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
    if (!newFiles?.length) {
      toast.info(t('fileUpload.chooseFile'))
      return
    }
    if (Array.from(newFiles).some(f => !f.name.toLowerCase().endsWith('.pdf'))) {
      toast.info(t('fileUpload.pdfOnly'))
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    const formData = new FormData()
    Array.from(newFiles).forEach(file => formData.append('files', file))
    formData.append('organization', organization)

    try {
      const { data } = await axios.post<{ job_id: string }>('/pipeline/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // Get filenames for notification
      const filenames = Array.from(newFiles).map(f => f.name)

      // Start job tracking
      startJobPolling(data.job_id, 'pdf', filenames)
      toast.info(t('fileUpload.pdfProcessing'))
    } catch (error) {
      toast.error(t('fileUpload.uploadError'))
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
    if (!newFiles?.length) {
      toast.info(t('fileUpload.chooseFile'))
      return
    }
    if (Array.from(newFiles).some(f => !f.name.toLowerCase().endsWith('.xml'))) {
      toast.info(t('fileUpload.xmlOnly'))
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    const formData = new FormData()
    Array.from(newFiles).forEach(file => formData.append('files', file))
    formData.append('organization', organization)

    try {
      const { data } = await axios.post<{ job_id: string }>('/pipeline/upload_xml', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // Get filenames for notification
      const filenames = Array.from(newFiles).map(f => f.name)

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
              disabled={uploading}
            />
            {/* PDF button */}
            <button
              onClick={handleUploadPdf}
              className="btn btn-primary"
              disabled={uploading}
              style={{ backgroundColor: '#00CC96', borderColor: '#00CC96' }}>
              {uploading ? t('fileUpload.processing') : t('fileUpload.uploadPdfButton')}
            </button>

            {/* XML button */}
            <button
              onClick={handleUploadXml}
              className="btn btn-primary"
              disabled={uploading}
              style={{ backgroundColor: '#006DCC', borderColor: '#006DCC', marginLeft: '8px' }}>
              {uploading ? t('fileUpload.processing') : t('fileUpload.uploadXmlButton')}
            </button>

            {/* Delete all */}
            <button
              onClick={handleDeleteAll}
              className="btn btn-danger"
              disabled={files.length === 0 || uploading}
              style={{ marginLeft: '10px' }}>
              {t('fileUpload.deleteAllButton')}
            </button>
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
