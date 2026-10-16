import { createRoot } from 'react-dom/client'
import App from './App'
import { handleOAuthPopup } from './cloud'
import { initStore } from './store'
import './styles.css'
import './v2.css'

if (!handleOAuthPopup()) initStore().then(() => createRoot(document.getElementById('root')!).render(<App />))
