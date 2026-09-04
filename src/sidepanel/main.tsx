// browser-extension/src/sidepanel/main.tsx
// 面板 React 入口：按 URL 形态分流——?mode=exec 为悬浮球旁执行框 iframe 的独占视图，
// 其余（无参数=右侧栏/options / ?mode=float=悬浮窗 / ?mode=embed=页内停靠）渲染完整面板。
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ExecutorPage } from './components/exec/ExecutorPage';
import { readCurrentMode } from '../shared/panel-mode';
import './globals.css';

const container: HTMLElement | null = document.getElementById('root');
if (container === null) {
  throw new Error('未找到 #root 挂载节点');
}

createRoot(container).render(readCurrentMode() === 'exec' ? <ExecutorPage /> : <App />);
