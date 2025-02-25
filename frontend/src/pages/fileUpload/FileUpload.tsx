import React, { useState, useEffect, useContext } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { AppStateContext } from '../../state/AppProvider' // Add this import
import Navbar from '../../components/Navbar/Navbar'
import { getUserInfo, UserInfo } from '../../api'
import { USER_ATTRIBUTE } from '../../constants/variables'
import './FileUpload.css'

interface FileUploadResponse {
  files: string[]
}

const FileUpload: React.FC = () => {
  const appStateContext = useContext(AppStateContext)
  const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled
  const [files, setFiles] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState<boolean>(false)
  const [organizationFilter, setOrganizationFilter] = useState<string>('all')
  const [showAuthMessage, setShowAuthMessage] = useState<boolean | undefined>()
  const [userDetails, setUserDetails] = useState<UserInfo[]>([])
  const [currentPage, setCurrentPage] = useState<number>(1)
  const filesPerPage = 10

  useEffect(() => {
    if (AUTH_ENABLED !== undefined) getUserInfoList()
  }, [AUTH_ENABLED])

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

  const getCompanyName = () => {
    if (userDetails && userDetails?.[0]?.user_claims) {
      const companyClaim = userDetails[0].user_claims.find(
        claim => claim.typ === USER_ATTRIBUTE
      )
      return companyClaim ? companyClaim.val.trim().toLowerCase() : ''
    }
    return ''
  }

  const fetchFiles = async () => {
    try {
      const response = await axios.get<FileUploadResponse>(`/pipeline/list`)
      setFiles(response.data.files)
    } catch (error) {
      toast.error('Failed to fetch files')
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setNewFiles(event.target.files)
    }
  }

  const handleUpload = async () => {
    if (!newFiles || newFiles.length === 0) {
      toast.info('Please select files to upload.')
      return
    }

    let companyName = getCompanyName()

    // Prompt for organization name if no company name is found
    if (companyName === '') {
      const inputOrganization = prompt('Please enter the organization name for the upload:')
      if (!inputOrganization || inputOrganization.trim() === '') {
        toast.error('Organization name is required to upload files.')
        return
      }
      companyName = inputOrganization.trim().toLowerCase()
    }

    setUploading(true)

    const formData = new FormData()
    Array.from(newFiles).forEach(file => {
      formData.append('files', file)
    })
    formData.append('organization', companyName)
    console.log('organization:', companyName)

    const uploadPromise = axios.post<FileUploadResponse>(`/pipeline/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    toast.promise(uploadPromise, {
      pending: 'Processing and chunking files, this might take a while...',
      success: 'Files uploaded and processed successfully!',
      error: {
        render({ data }: { data: any }) {
          const errorMessage = data?.response?.data?.error || 'An error occurred during upload.'
          return errorMessage
        }
      }
    })

    try {
      await uploadPromise
      await fetchFiles()
      setNewFiles(null)
    } catch (error) {
    } finally {
      setUploading(false)
      const fileInput = document.getElementById('file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''
    }
  }

  const handleDeleteAll = async () => {
    const isConfirmed = window.confirm(
      'Are you sure you want to delete files and documents? This action cannot be undone.'
    )
    if (!isConfirmed) return

    try {
      const formData = new FormData()
      formData.append('organizationFilter', organizationFilter)
      if (companyName) {
        formData.append("companyClaim", companyName);
      }

      const deletePromise = axios.delete(`/pipeline/delete_all`, {
        data: formData
      })

      toast.promise(deletePromise, {
        pending: 'Deleting files and documents...',
        success: 'Files and documents have been deleted!',
        error: 'Failed to delete files and documents'
      })

      await deletePromise
      await fetchFiles() // Refresh the files list after deletion
      setOrganizationFilter('all')
      setCurrentPage(1)
    } catch (error) {
      console.error('Error deleting files and documents:', error)
      toast.error('An unexpected error occurred while deleting files.')
    }
  }

  const handleDeleteSingleFile = async (filename: string) => {
    const isConfirmed = window.confirm(`Are you sure you want to delete '${filename}' and all related documents?`)
    if (!isConfirmed) return

    try {
      const deletePromise = axios.delete(`/pipeline/delete_file/${filename}`)
      toast.promise(deletePromise, {
        pending: `Deleting ${filename}...`,
        success: `File '${filename}' and associated documents have been deleted!`,
        error: {
          render({ data }: { data: any }) {
            const errorMessage = data?.response?.data?.message || `Failed to delete '${filename}'.`
            return errorMessage
          }
        }
      })

      await deletePromise
      await fetchFiles()
      setOrganizationFilter('all')
    } catch (error) {}
  }

  // Get the company name
  const companyName = getCompanyName()

  // Extract unique organizations if no company name is defined
  const organizations = companyName ? [] : Array.from(new Set(files.map(file => file.split('/')[0])))

  // Filter files based on the company name or selected organization
  const filteredFiles = companyName
    ? files.filter(file => file.startsWith(`${companyName}/`)) // Match exact folder name with trailing '/'
    : organizationFilter === 'all'
      ? files
      : files.filter(file => file.startsWith(`${organizationFilter}/`)) // Match exact folder name with trailing '/'

  // Calculate pagination
  const indexOfLastFile = currentPage * filesPerPage
  const indexOfFirstFile = indexOfLastFile - filesPerPage
  const currentFiles = filteredFiles.slice(indexOfFirstFile, indexOfLastFile)
  const totalPages = Math.ceil(filteredFiles.length / filesPerPage)

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prevPage => prevPage + 1)
    }
  }

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prevPage => prevPage - 1)
    }
  }

  return (
    <>
      <Navbar />
      <div className="main-container">
        <div className="file-upload-container">
          <h2>Upload and Process Files</h2>
          <div className="upload-section">
            <input
              id="file-input"
              type="file"
              multiple
              accept="application/pdf"
              onChange={handleFileChange}
              className="file-input"
              disabled={uploading}
            />
            <button
              onClick={handleUpload}
              className="btn btn-primary"
              disabled={uploading}
              style={{ backgroundColor: '#00CC96', borderColor: '#00CC96' }}>
              {uploading ? 'Processing...' : 'Upload'}
            </button>

            <button
              onClick={handleDeleteAll}
              className="btn btn-danger"
              disabled={files.length === 0 || uploading}
              style={{ marginLeft: '10px' }}>
              Delete All
            </button>
          </div>

          {!companyName && (
            <div className="filter-section mb-3">
              <label htmlFor="organization-filter">Filter by Organization:</label>
              <select
                id="organization-filter"
                value={organizationFilter}
                onChange={e => {
                  setOrganizationFilter(e.target.value)
                  setCurrentPage(1)
                }}>
                <option value="all">All</option>
                {organizations.map((org, index) => (
                  <option key={index} value={org}>
                    {org}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="file-list">
            <h3>Uploaded Files</h3>
            {currentFiles.length === 0 ? (
              <p>No files uploaded yet.</p>
            ) : (
              <ul>
                {currentFiles.map((file, index) => (
                  <li
                    key={index}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '6px'
                    }}>
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

            {/* Pagination Controls */}
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
