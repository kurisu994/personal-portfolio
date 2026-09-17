import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/noto-serif-sc';
import App from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('未找到应用挂载节点');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
