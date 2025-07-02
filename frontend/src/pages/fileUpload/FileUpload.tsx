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

interface FileUploadResponse {
  files: string[]
}

const FileUpload: React.FC = () => {
  const appStateContext = useContext(AppStateContext)
  const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled
  const { userInfo, authEnabled } = useAppUser()
  /* ------------------------------------------------------------------ */
  /*  state                                                             */
  /* ------------------------------------------------------------------ */
  const [files, setFiles] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState<boolean>(false)
  const [organizationFilter, setOrganizationFilter] = useState<string>('all')
  const [showAuthMessage, setShowAuthMessage] = useState<boolean | undefined>()
  // const [userDetails, setUserDetails] = useState<UserInfo[]>([])
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
      const input = prompt('Bitte geben Sie für den Upload den Organisationsnamen ein:')
      if (!input?.trim()) {
        toast.error('Zum Hochladen von Dateien ist der Name der Organisation erforderlich.')
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
      toast.error('Abrufen der Dateien fehlgeschlagen')
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
      toast.info('Bitte wählen Sie die hochzuladenden Dateien aus.')
      return
    }
    if (Array.from(newFiles).some(f => !f.name.toLowerCase().endsWith('.pdf'))) {
      toast.info('Bitte wählen Sie nur PDF-Dateien für diesen Button aus.')
      return
    }

    const organization = await validateOrgName()
    if (!organization) return

    setUploading(true)
    const formData = new FormData()
    Array.from(newFiles).forEach(file => formData.append('files', file))
    formData.append('organization', organization)

    const uploadPromise = axios.post<FileUploadResponse>('/pipeline/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    toast.promise(uploadPromise, {
      pending: 'Das Verarbeiten und Aufteilen von Dateien kann eine Weile dauern ...',
      success: 'Dateien erfolgreich hochgeladen und verarbeitet!',
      error: 'Beim Hochladen ist ein Fehler aufgetreten.'
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
  /*  XML upload – NEW                                                  */
  /* ------------------------------------------------------------------ */
  const handleUploadXml = async () => {
    if (!newFiles?.length) {
      toast.info('Bitte wählen Sie die hochzuladenden Dateien aus.')
      return
    }
    if (Array.from(newFiles).some(f => !f.name.toLowerCase().endsWith('.xml'))) {
      toast.info('Bitte wählen Sie nur XML-Dateien für diesen Button aus.')
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
      pending: 'XML wird verarbeitet...',
      success: 'XML-Dateien erfolgreich hochgeladen!',
      error: 'Beim Hochladen ist ein Fehler aufgetreten.'
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
      'Möchten Sie Dateien und Dokumente wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.'
    )
    if (!isConfirmed) return

    try {
      const formData = new FormData()
      formData.append('organizationFilter', organizationFilter)
      const companyName = getCompanyName()
      if (companyName) formData.append('companyClaim', companyName)

      const deletePromise = axios.delete(`/pipeline/delete_all`, { data: formData })

      toast.promise(deletePromise, {
        pending: 'Dateien und Dokumente werden gelöscht...',
        success: 'Dateien und Dokumente wurden gelöscht!',
        error: 'Das Löschen von Dateien und Dokumenten ist fehlgeschlagen'
      })

      await deletePromise
      await fetchFiles()
      setOrganizationFilter('all')
      setCurrentPage(1)
    } catch (error) {
      console.error('Error deleting files and documents:', error)
      toast.error('Beim Löschen von Dateien ist ein unerwarteter Fehler aufgetreten.')
    }
  }

  const handleDeleteSingleFile = async (filename: string) => {
    const isConfirmed = window.confirm(`Möchten Sie ${filename} und alle zugehörigen Dokumente wirklich löschen?`)
    if (!isConfirmed) return

    try {
      const deletePromise = axios.delete(`/pipeline/delete_file/${filename}`)

      toast.promise(deletePromise, {
        pending: `${filename} wird gelöscht...`,
        success: `Datei „${filename}“ und zugehörige Dokumente wurden gelöscht!`,
        error: {
          render({ data }: { data: any }) {
            const msg = data?.response?.data?.message || `„${filename}“ konnte nicht gelöscht werden.`
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
              {uploading ? 'Verarbeitung...' : 'PDF hochladen'}
            </button>

            {/* XML button – NEW */}
            <button
              onClick={handleUploadXml} // NEW
              className="btn btn-primary"
              disabled={uploading}
              style={{ backgroundColor: '#006DCC', borderColor: '#006DCC', marginLeft: '8px' }}>
              {uploading ? 'Verarbeitung...' : 'XML hochladen'}
            </button>

            {/* Delete all */}
            <button
              onClick={handleDeleteAll}
              className="btn btn-danger"
              disabled={files.length === 0 || uploading}
              style={{ marginLeft: '10px' }}>
              Alle löschen
            </button>
          </div>

          {/* Filter by organisation */}
          {!companyName && (
            <div className="filter-section mb-3">
              <label htmlFor="organization-filter">Filtern nach Organisation: </label>
              <select
                id="organization-filter"
                value={organizationFilter}
                onChange={e => {
                  setOrganizationFilter(e.target.value)
                  setCurrentPage(1)
                }}>
                <option value="all">Alle</option>
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
            <h3>Hochgeladene Dateien</h3>
            {currentFiles.length === 0 ? (
              <p>Noch keine Dateien hochgeladen.</p>
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
                      Löschen
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* pagination */}
            {filteredFiles.length > filesPerPage && (
              <div className="pagination-controls" style={{ marginTop: '10px' }}>
                <button onClick={handlePrevPage} className="btn btn-light" disabled={currentPage === 1}>
                  Vorherige
                </button>
                <span style={{ margin: '0 10px' }}>
                  Seite {currentPage} of {totalPages}
                </span>
                <button onClick={handleNextPage} className="btn btn-light" disabled={currentPage === totalPages}>
                  Nächste
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
