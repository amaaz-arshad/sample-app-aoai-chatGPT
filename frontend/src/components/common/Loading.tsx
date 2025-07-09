import logo from '../../assets/Snap.svg'

const Loading = () => {
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)'
        }}>
        Loading...
      </div>
    </div>
  )
}

export default Loading
