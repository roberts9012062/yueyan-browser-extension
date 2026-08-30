// browser-extension/src/sidepanel/main.tsx
// 面板 React 入口。
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './globals.css';

const container: HTMLElement | null = document.getElementById('root');
if (container === null) {
  throw new Error('未找到 #root 挂载节点');
}

createRoot(container).render(<App />);
