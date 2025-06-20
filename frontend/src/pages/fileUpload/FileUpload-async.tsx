import React, { useState, useEffect, useContext } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AppStateContext } from '../../state/AppProvider'
import Navbar from '../../components/Navbar/Navbar'
import { getUserInfo, UserInfo } from '../../api'
import { FILTER_FIELD } from '../../constants/variables'
import './FileUpload.css'

interface FileUploadResponse {
  files: string[]
}

const FileUpload: React.FC = () => {
  const appStateContext = useContext(AppStateContext)
  const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled

  /* ------------------------------------------------------------------ */
  /*  state                                                             */
  /* ------------------------------------------------------------------ */
  const [files, setFiles] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState<boolean>(false)
  const [organizationFilter, setOrganizationFilter] = useState<string>('all')
  const [showAuthMessage, setShowAuthMessage] = useState<boolean | undefined>()
  const [userDetails, setUserDetails] = useState<UserInfo[]>([])
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [processingStatus, setProcessingStatus] = useState('idle')
  const filesPerPage = 10

  /* ------------------------------------------------------------------ */
  /*  auth helper                                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (AUTH_ENABLED !== undefined) getUserInfoList()
  }, [AUTH_ENABLED])

  // useEffect(() => {
  //   let interval: NodeJS.Timeout

  //   if (processingStatus === 'processing') {
  //     interval = setInterval(() => {
  //       checkProcessingStatus()
  //     }, 20000) // Check every 20 seconds
  //   }

  //   return () => {
  //     if (interval) clearInterval(interval)
  //   }
  // }, [processingStatus])

  const getUserInfoList = async () => {
    if (!AUTH_ENABLED) {
      setShowAuthMessage(false)
      return
    }
    const userInfoList = await getUserInfo()
    setUserDetails(userInfoList)
    if (userInfoList.length === 0 && window.location.hostname !== '127.0.0.1') {
      setShowAuthMessage(true)
    } else {
      setShowAuthMessage(false)
    }
  }

  /* ------------------------------------------------------------------ */
  /*  company / organisation helpers                                    */
  /* ------------------------------------------------------------------ */
  const getCompanyName = () => {
    if (userDetails?.[0]?.user_claims) {
      const claim = userDetails[0].user_claims.find(c => c.typ === FILTER_FIELD)
      return claim
        ? claim.val
            .trim()
            .toLowerCase()
            .replace(/^.\.+|\.+$/g, '')
        : ''
    }
    return ''
  }

  const validateOrgName = async (): Promise<string | null> => {
    let org = getCompanyName()
    if (org === '') {
      const input = prompt('Please enter the organization name for the upload:')
      if (!input?.trim()) {
        toast.error('An organization name is required to upload files.')
        return null
      }
      org = input
        .trim()
        .toLowerCase()
        .replace(/^.\.+|\.+$/g, '')
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
      toast.error('Failed to fetch files')
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
  /*  PDF upload                                                        */
  /* ------------------------------------------------------------------ */
  const handleUploadPdf = async () => {
    if (!newFiles?.length) {
      toast.info('Please select the files to upload.')
      return
    }

    if (Array.from(newFiles).some(f => !f.name.toLowerCase().endsWith('.pdf'))) {
      toast.info('Please select only PDF files for this button.')
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    setProcessingStatus('processing')

    const formData = new FormData()
    Array.from(newFiles).forEach(file => formData.append('files', file))
    formData.append('organization', organization)

    try {
      const response = await axios.post('/pipeline/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // Show immediate success message
      toast.success('Dateien werden im Hintergrund verarbeitet')

      // Start polling for status
      const pollStatus = async () => {
        try {
          const { data } = await axios.get('/pipeline/status')
          if (data.completed_at) {
            setProcessingStatus('completed')
            fetchFiles() // Refresh file list
            toast.success(
              `Verarbeitung abgeschlossen! Erfolgreich: ${data.processed_files.length}, Übersprungen: ${data.skipped_files.length}`
            )
          } else {
            // Still processing, poll again
            setTimeout(pollStatus, 5000)
          }
        } catch (pollError) {
          setProcessingStatus('error')
          toast.error('Fehler beim Abrufen des Status')
        }
      }

      // Start polling after 5 seconds
      setTimeout(pollStatus, 5000)
    } catch (err) {
      setProcessingStatus('error')
      toast.error('Beim Hochladen ist ein Fehler aufgetreten')
    } finally {
      setUploading(false)
      ;(document.getElementById('file-input') as HTMLInputElement).value = ''
    }
  }

  /* ------------------------------------------------------------------ */
  /*  XML upload – NEW                                                  */
  /* ------------------------------------------------------------------ */
  const handleUploadXml = async () => {
    if (!newFiles?.length) {
      toast.info('Please select the files to upload.')
      return
    }
    if (Array.from(newFiles).some(f => !f.name.toLowerCase().endsWith('.xml'))) {
      toast.info('Please select only XML files for this button.')
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    const formData = new FormData()
    Array.from(newFiles).forEach(file => formData.append('files', file))
    formData.append('organization', organization)

    const uploadPromise = axios.post<FileUploadResponse>('/pipeline/upload_xml', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    toast.promise(uploadPromise, {
      pending: 'Processing XML...',
      success: 'XML files uploaded successfully!',
      error: 'An error occurred during upload.'
    })

    try {
      await uploadPromise
      setNewFiles(null)
    } finally {
      setUploading(false)
      ;(document.getElementById('file-input') as HTMLInputElement).value = ''
      fetchFiles()
    }
  }

  /* ------------------------------------------------------------------ */
  /*  delete helpers (unchanged)                                        */
  /* ------------------------------------------------------------------ */
  const handleDeleteAll = async () => {
    const isConfirmed = window.confirm(
      'Are you sure you want to delete files and documents? This action cannot be undone.'
    )
    if (!isConfirmed) return

    try {
      const formData = new FormData()
      formData.append('organizationFilter', organizationFilter)
      const companyName = getCompanyName()
      if (companyName) formData.append('companyClaim', companyName)

      const deletePromise = axios.delete(`/pipeline/delete_all`, { data: formData })

      toast.promise(deletePromise, {
        pending: 'Deleting files and documents...',
        success: 'Files and documents have been deleted!',
        error: 'Deleting files and documents failed'
      })

      await deletePromise
      await fetchFiles()
      setOrganizationFilter('all')
      setCurrentPage(1)
    } catch (error) {
      console.error('Error deleting files and documents:', error)
      toast.error('An unexpected error occurred while deleting files.')
    }
  }

  const handleDeleteSingleFile = async (filename: string) => {
    const isConfirmed = window.confirm(`Are you sure you want to delete ${filename} and all associated documents?`)
    if (!isConfirmed) return

    try {
      const deletePromise = axios.delete(`/pipeline/delete_file/${filename}`)

      toast.promise(deletePromise, {
        pending: `${filename} is being deleted...`,
        success: `File "${filename}" and associated documents have been deleted!`,
        error: {
          render({ data }: { data: any }) {
            const msg = data?.response?.data?.message || `"${filename}" could not be deleted.`
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
  /*  filter + pagination (unchanged)                                   */
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

  const checkProcessingStatus = async () => {
    try {
      const response = await axios.get('/pipeline/status')
      // console.log('Processing status response:', response.data)
      // const { processed_files, skipped_files } = response.data

      // if (processed_files.length > 0 || skipped_files.length > 0) {
      //   setProcessingStatus('completed')
      //   fetchFiles()
      //   toast.info(`Processed: ${processed_files.length} files, Skipped: ${skipped_files.length}`)
      // } else {
      //   toast.info('Processing still ongoing...')
      // }
      toast.info('Processing still ongoing...')
    } catch (error) {
      console.error('Error fetching processing status:', error)
      toast.error('Error fetching status')
    }
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
              {uploading ? 'Processing...' : 'Upload PDF'}
            </button>

            {/* XML button – NEW */}
            <button
              onClick={handleUploadXml}
              className="btn btn-primary"
              disabled={uploading}
              style={{ backgroundColor: '#006DCC', borderColor: '#006DCC', marginLeft: '8px' }}>
              {uploading ? 'Processing...' : 'Upload XML'}
            </button>

            {processingStatus === 'processing' && (
              <button
                onClick={checkProcessingStatus}
                className="btn btn-info"
                style={{ marginLeft: '8px', backgroundColor: '#17a2b8', borderColor: '#17a2b8' }}>
                Check Status
              </button>
            )}

            {/* Delete all */}
            <button
              onClick={handleDeleteAll}
              className="btn btn-danger"
              disabled={files.length === 0 || uploading}
              style={{ marginLeft: '10px' }}>
              Delete All
            </button>
          </div>

          {/* Filter by organisation */}
          {!companyName && (
            <div className="filter-section mb-3">
              <label htmlFor="organization-filter">Filter by organization: </label>
              <select
                id="organization-filter"
                value={organizationFilter}
                onChange={e => {
                  setOrganizationFilter(e.target.value)
                  setCurrentPage(1)
                }}>
                <option value="all">All</option>
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
            <h3>Uploaded Files</h3>
            {currentFiles.length === 0 ? (
              <p>No files uploaded yet.</p>
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
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* pagination */}
            {filteredFiles.length > filesPerPage && (
              <div className="pagination-controls" style={{ marginTop: '10px' }}>
                <button onClick={handlePrevPage} className="btn btn-light" disabled={currentPage === 1}>
                  Previous
                </button>
                <span style={{ margin: '0 10px' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button onClick={handleNextPage} className="btn btn-light" disabled={currentPage === totalPages}>
                  Next
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
