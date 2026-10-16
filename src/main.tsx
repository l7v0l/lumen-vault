import { createRoot } from 'react-dom/client'
import App from './App'
import { handleOAuthPopup } from './cloud'
import './styles.css'
import './v2.css'

if (!handleOAuthPopup()) createRoot(document.getElementById('root')!).render(<App />)
